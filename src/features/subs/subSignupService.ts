import { GraphQLError } from 'graphql'

import type { PlaySegmentSide, SubAvailabilityMode } from '../../generated/prisma/client.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { getEasternDayRangeUtc } from '../../shared/time.js'
import {
  calculateSessionDurationMinutes,
  isValidPartialMinutes,
  partialMinutesBlockSize
} from '../../shared/attendanceCoverage.js'
import { SessionService } from '../sessions/sessionService.js'

import { rebalanceSubSelection, shouldRebalanceSubSelection } from './subSelectionRebalanceService.js'

const subSignupStatusActive = 'ACTIVE'
const subSignupStatusSelected = 'SELECTED'
const subSignupStatusCanceled = 'CANCELED'
const occurrenceStatusCanceled = 'CANCELED'
const leagueMembershipStatusActive = 'ACTIVE'
const graphQLErrorCodeBadUserInput = 'BAD_USER_INPUT'
const registrationAlreadyActiveReason = 'REGISTRATION_ALREADY_ACTIVE'

export type SetSubAvailabilityPreferenceInput = {
  availabilityMode: SubAvailabilityMode
  side?: PlaySegmentSide | null
  minutes?: number | null
}

type SignupOptions = {
  triggerRebalance?: boolean
}

type RebalanceEligibleOccurrence = {
  id: string
  startsAt: Date
  endsAt: Date
  status: 'ACTIVE' | 'CANCELED'
}

/**
 * SubSignupService
 * - Creates or reactivates sub signups for sessions.
 * - Cancels sub signups when requested.
 * - Updates sub availability and partial lock preferences.
 * - Used by sub signup mutations.
 */
export class SubSignupService {
  protected shouldTriggerRebalance(
    occurrence: RebalanceEligibleOccurrence,
    now: Date = new Date()
  ): boolean {
    return shouldRebalanceSubSelection(occurrence, now)
  }

  protected async rebalanceOccurrence(occurrenceId: string): Promise<void> {
    await rebalanceSubSelection(occurrenceId)
  }

  public async signup(userId: string, occurrenceId: string, options?: SignupOptions) {
    const errorOccurrenceMissing = 'Session occurrence missing'
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { session: true }
    })

    if (!occurrence) {
      throw new Error(errorOccurrenceMissing)
    }

    if (occurrence.status === occurrenceStatusCanceled) {
      logger.warn({ occurrenceId, userId }, 'Sub signup attempt for canceled occurrence')
      throw new Error('Session occurrence canceled')
    }

    const sessionService = new SessionService()
    const now = new Date()
    const logSubSignupOutsideWindow = 'Sub signup attempt outside window'
    const logResolvedSubSignupAssignmentStatus = 'Resolved sub signup assignment status'
    const logResolvedSubSignupEligibility = 'Resolved sub signup eligibility'
    const logSubSignupSameDayRegistration = 'Sub signup attempt with same-day attendance'
    const logSubSignupSameDaySubSignup = 'Sub signup attempt with existing sub on same day'
    const logUserSignedUpAsSub = 'User signed up as sub'
    const errorSubSignupWindowClosed = 'Sub signup window closed'
    const errorUserAlreadyRegisteredSameDay = 'User already registered for a session that day'
    const errorUserAlreadySignedUpAsSubSameDay = 'User already signed up as a sub that day'

    if (!sessionService.isWithinSubSignupWindow(now, occurrence.endsAt)) {
      logger.warn({ occurrenceId, userId }, logSubSignupOutsideWindow)
      throw new Error(errorSubSignupWindowClosed)
    }

    const leagueMembership = await prisma.leagueMembership.findUnique({
      where: {
        leagueId_userId: {
          leagueId: occurrence.session.leagueId,
          userId
        }
      },
      select: {
        status: true
      }
    })

    if (!leagueMembership || leagueMembership.status !== leagueMembershipStatusActive) {
      logger.warn({ occurrenceId, userId }, 'Sub signup attempt without active league membership')
      throw new Error('User not active in this league')
    }

    const assignment = await prisma.slotAssignment.findUnique({
      where: {
        leagueId_userId: {
          leagueId: occurrence.session.leagueId,
          userId
        }
      }
    })
    const isUserAssignedToSession = assignment?.sessionId === occurrence.sessionId
    logger.info({ occurrenceId, userId, isUserAssignedToSession }, logResolvedSubSignupAssignmentStatus)

    const { start, end } = getEasternDayRangeUtc(occurrence.startsAt)
    const existingRegistrationForOccurrence = await prisma.sessionRegistration.findUnique({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      select: { status: true }
    })
    const hasActiveRegistrationForOccurrence =
      existingRegistrationForOccurrence?.status === 'ATTENDING'

    const existingRegistration = await prisma.sessionRegistration.findFirst({
      where: {
        userId,
        status: 'ATTENDING',
        occurrenceId: {
          not: occurrenceId
        },
        occurrence: {
          startsAt: { gte: start, lte: end }
        }
      }
    })

    const existingSubSignup = await prisma.subSignup.findFirst({
      where: {
        userId,
        status: { in: [subSignupStatusActive, subSignupStatusSelected] },
        occurrence: {
          startsAt: { gte: start, lte: end }
        }
      }
    })

    logger.info(
      {
        occurrenceId,
        userId,
        isUserAssignedToSession,
        hasSameDayRegistration:
          hasActiveRegistrationForOccurrence || Boolean(existingRegistration),
        hasSameDaySubSignup: Boolean(existingSubSignup),
        existingSubSignupOccurrenceId: existingSubSignup?.occurrenceId ?? null
      },
      logResolvedSubSignupEligibility
    )

    if (hasActiveRegistrationForOccurrence) {
      throw new GraphQLError('Registration already active for this occurrence', {
        extensions: {
          code: graphQLErrorCodeBadUserInput,
          reason: registrationAlreadyActiveReason
        }
      })
    }

    if (existingRegistration) {
      logger.warn({ occurrenceId, userId }, logSubSignupSameDayRegistration)
      throw new Error(errorUserAlreadyRegisteredSameDay)
    }

    if (existingSubSignup && existingSubSignup.occurrenceId !== occurrenceId) {
      logger.warn({ occurrenceId, userId }, logSubSignupSameDaySubSignup)
      throw new Error(errorUserAlreadySignedUpAsSubSameDay)
    }

    const existingSignupForOccurrence = await prisma.subSignup.findUnique({
      where: { userId_occurrenceId: { userId, occurrenceId } }
    })

    if (
      existingSignupForOccurrence &&
      (existingSignupForOccurrence.status === subSignupStatusActive ||
        existingSignupForOccurrence.status === subSignupStatusSelected)
    ) {
      logger.info({ occurrenceId, userId }, logUserSignedUpAsSub)
      return existingSignupForOccurrence
    }

    const subSignup = existingSignupForOccurrence
      ? await prisma.subSignup.update({
          where: { userId_occurrenceId: { userId, occurrenceId } },
          data: {
            status: subSignupStatusActive,
            signedUpAt: now,
            selectionRank: null,
            selectedAt: null,
            selectionType: null,
            assignedStartOffsetMinutes: null,
            assignedEndOffsetMinutes: null,
            partialLocked: false,
            partialLockedAt: null
          }
        })
      : await prisma.subSignup.create({
          data: {
            userId,
            occurrenceId,
            status: subSignupStatusActive,
            signedUpAt: now
          }
        })

    logger.info({ occurrenceId, userId }, logUserSignedUpAsSub)

    const shouldTriggerRebalance = options?.triggerRebalance ?? true
    if (shouldTriggerRebalance && this.shouldTriggerRebalance(occurrence, now)) {
      await this.rebalanceOccurrence(occurrence.id)
    }

    return subSignup
  }

  public async cancel(userId: string, occurrenceId: string) {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      select: { id: true, startsAt: true, endsAt: true, status: true }
    })
    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const logUserCanceledSubSignup = 'User canceled sub signup'
    const subSignup = await prisma.subSignup.update({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      data: {
        status: subSignupStatusCanceled,
        selectionType: null,
        assignedStartOffsetMinutes: null,
        assignedEndOffsetMinutes: null,
        partialLocked: false,
        partialLockedAt: null
      }
    })

    logger.info({ occurrenceId, userId }, logUserCanceledSubSignup)
    if (this.shouldTriggerRebalance(occurrence)) {
      await this.rebalanceOccurrence(occurrence.id)
    }
    return subSignup
  }

  public async setAvailabilityPreference(
    userId: string,
    occurrenceId: string,
    input: SetSubAvailabilityPreferenceInput
  ) {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { session: true }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    if (occurrence.status === occurrenceStatusCanceled) {
      throw new Error('Session occurrence canceled')
    }

    const now = new Date()
    const sessionService = new SessionService()
    if (!sessionService.isWithinSubSignupWindow(now, occurrence.endsAt)) {
      throw new Error('Sub signup window closed')
    }

    const sessionDurationMinutes = calculateSessionDurationMinutes(occurrence.startsAt, occurrence.endsAt)
    if (sessionDurationMinutes <= 0) {
      throw new Error('Session duration invalid')
    }

    const availabilityMode = input.availabilityMode
    let availabilitySegmentSide = input.side ?? null
    let availabilityMinutes = input.minutes ?? null

    if (availabilityMode === 'FULL_ONLY') {
      availabilitySegmentSide = null
      availabilityMinutes = null
    } else if (availabilityMode === 'PARTIAL_ONLY') {
      const validPartialOnlyPreference =
        availabilitySegmentSide !== null &&
        availabilityMinutes !== null &&
        isValidPartialMinutes(availabilityMinutes, sessionDurationMinutes) &&
        availabilityMinutes < sessionDurationMinutes
      if (!validPartialOnlyPreference) {
        throw new Error(
          `PARTIAL_ONLY availability requires side and ${partialMinutesBlockSize}-minute block minutes less than session duration`
        )
      }
    } else {
      const hasEitherPartialValue = availabilitySegmentSide !== null || availabilityMinutes !== null
      if (hasEitherPartialValue) {
        const validFlexPartialPreference =
          availabilitySegmentSide !== null &&
          availabilityMinutes !== null &&
          isValidPartialMinutes(availabilityMinutes, sessionDurationMinutes) &&
          availabilityMinutes < sessionDurationMinutes
        if (!validFlexPartialPreference) {
          throw new Error(
            `FLEX partial preference requires side and ${partialMinutesBlockSize}-minute block minutes less than session duration`
          )
        }
      } else {
        availabilitySegmentSide = null
        availabilityMinutes = null
      }
    }

    const existingSignup = await prisma.subSignup.findUnique({
      where: { userId_occurrenceId: { userId, occurrenceId } }
    })
    const ensuredSignup =
      !existingSignup || existingSignup.status === subSignupStatusCanceled
        ? await this.signup(userId, occurrenceId, { triggerRebalance: false })
        : existingSignup

    const updatedSignup = await prisma.subSignup.update({
      where: { id: ensuredSignup.id },
      data: {
        availabilityMode,
        availabilitySegmentSide,
        availabilityMinutes,
        partialLocked: availabilityMode === 'FULL_ONLY' ? false : ensuredSignup.partialLocked,
        partialLockedAt:
          availabilityMode === 'FULL_ONLY' ? null : ensuredSignup.partialLockedAt
      }
    })

    if (this.shouldTriggerRebalance(occurrence, now)) {
      await this.rebalanceOccurrence(occurrence.id)
    }

    return updatedSignup
  }

  public async setPartialLock(userId: string, occurrenceId: string, isLocked: boolean) {
    const [occurrence, subSignup] = await prisma.$transaction([
      prisma.sessionOccurrence.findUnique({
        where: { id: occurrenceId },
        include: { session: true }
      }),
      prisma.subSignup.findUnique({
        where: { userId_occurrenceId: { userId, occurrenceId } }
      })
    ])

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    if (!subSignup) {
      throw new Error('Sub signup missing')
    }

    const now = new Date()
    const sessionService = new SessionService()
    const { registrationCloseAt } = sessionService.calculateRegistrationWindow(occurrence.startsAt)
    if (now < registrationCloseAt) {
      throw new Error('Partial lock is only available after registration closes')
    }

    if (isLocked && (subSignup.status !== subSignupStatusSelected || subSignup.selectionType !== 'PARTIAL')) {
      throw new Error('Only selected partial subs can lock a partial spot')
    }

    const updatedSignup = await prisma.subSignup.update({
      where: { id: subSignup.id },
      data: {
        partialLocked: isLocked,
        partialLockedAt: isLocked ? now : null
      }
    })

    if (this.shouldTriggerRebalance(occurrence, now)) {
      await this.rebalanceOccurrence(occurrence.id)
    }

    return updatedSignup
  }
}
