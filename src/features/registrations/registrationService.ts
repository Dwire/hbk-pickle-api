import type { PlaySegmentSide, RegistrationPlayMode } from '../../generated/prisma/client.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { getEasternDayRangeUtc } from '../../shared/time.js'
import { SessionService } from '../sessions/sessionService.js'
import { rebalanceSubSelection, shouldRebalanceSubSelection } from '../subs/subSelectionRebalanceService.js'

const occurrenceStatusCanceled = 'CANCELED'
const leagueMembershipStatusActive = 'ACTIVE'
const minutesPerBlock = 30
const millisecondsPerMinute = 60_000

type TimeSegment = {
  startOffsetMinutes: number
  endOffsetMinutes: number
}

export type SetRegistrationPlayPreferenceInput = {
  mode: RegistrationPlayMode
  side?: PlaySegmentSide | null
  minutes?: number | null
  fillTargetRegistrationId?: string | null
}

const isThirtyMinuteBlock = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value % minutesPerBlock === 0

const calculateSessionDurationMinutes = (startsAt: Date, endsAt: Date): number =>
  Math.max(Math.round((endsAt.getTime() - startsAt.getTime()) / millisecondsPerMinute), 0)

const buildOwnSegment = (
  mode: RegistrationPlayMode,
  side: PlaySegmentSide | null,
  minutes: number | null,
  sessionDurationMinutes: number
): TimeSegment => {
  const isValidPartial =
    mode === 'PARTIAL' &&
    side !== null &&
    minutes !== null &&
    isThirtyMinuteBlock(minutes) &&
    minutes < sessionDurationMinutes

  if (!isValidPartial) {
    return {
      startOffsetMinutes: 0,
      endOffsetMinutes: sessionDurationMinutes
    }
  }

  if (side === 'START') {
    return {
      startOffsetMinutes: 0,
      endOffsetMinutes: minutes
    }
  }

  return {
    startOffsetMinutes: sessionDurationMinutes - minutes,
    endOffsetMinutes: sessionDurationMinutes
  }
}

const buildGapSegment = (
  mode: RegistrationPlayMode,
  side: PlaySegmentSide | null,
  minutes: number | null,
  sessionDurationMinutes: number
): TimeSegment | null => {
  const isValidPartial =
    mode === 'PARTIAL' &&
    side !== null &&
    minutes !== null &&
    isThirtyMinuteBlock(minutes) &&
    minutes < sessionDurationMinutes

  if (!isValidPartial) {
    return null
  }

  if (side === 'START') {
    return {
      startOffsetMinutes: minutes,
      endOffsetMinutes: sessionDurationMinutes
    }
  }

  return {
    startOffsetMinutes: 0,
    endOffsetMinutes: sessionDurationMinutes - minutes
  }
}

const segmentsOverlap = (left: TimeSegment, right: TimeSegment): boolean =>
  left.startOffsetMinutes < right.endOffsetMinutes && right.startOffsetMinutes < left.endOffsetMinutes

/**
 * RegistrationService
 * - Upserts attendance registrations for sessions.
 * - Cancels attendance when requested.
 * - Updates partial-time attendance preferences for registered players.
 * - Used by registration mutations.
 */
export class RegistrationService {
  public async register(userId: string, occurrenceId: string) {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { session: true }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    if (occurrence.status === occurrenceStatusCanceled) {
      logger.warn({ occurrenceId, userId }, 'Registration attempt for canceled occurrence')
      throw new Error('Session occurrence canceled')
    }

    const sessionService = new SessionService()
    const now = new Date()

    if (!sessionService.isWithinRegistrationWindow(now, occurrence.startsAt)) {
      logger.warn({ occurrenceId, userId }, 'Registration attempt outside window')
      throw new Error('Registration window closed')
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
      logger.warn({ occurrenceId, userId }, 'Registration attempt without active league membership')
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

    if (assignment?.sessionId !== occurrence.sessionId) {
      logger.warn({ occurrenceId, userId }, 'Registration attempt without assignment')
      throw new Error('User not assigned to this session')
    }

    const { start, end } = getEasternDayRangeUtc(occurrence.startsAt)
    const existingRegistration = await prisma.sessionRegistration.findFirst({
      where: {
        userId,
        status: 'ATTENDING',
        occurrence: {
          startsAt: { gte: start, lte: end }
        }
      }
    })

    if (existingRegistration && existingRegistration.occurrenceId !== occurrenceId) {
      logger.warn({ occurrenceId, userId }, 'Registration attempt with same-day attendance')
      throw new Error('User already registered for a session that day')
    }

    const registration = await prisma.sessionRegistration.upsert({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      create: {
        userId,
        occurrenceId,
        status: 'ATTENDING'
      },
      update: { status: 'ATTENDING' }
    })

    logger.info({ occurrenceId, userId }, 'User registered for session')
    return registration
  }

  public async cancel(userId: string, occurrenceId: string) {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      select: { id: true, startsAt: true, endsAt: true, status: true }
    })
    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const registration = await prisma.sessionRegistration.update({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      data: {
        status: 'CANCELED',
        playMode: 'FULL',
        playSegmentSide: null,
        playMinutes: null,
        fillTargetRegistrationId: null
      }
    })

    if (shouldRebalanceSubSelection(occurrence)) {
      await rebalanceSubSelection(occurrence.id)
    }

    return registration
  }

  public async setPlayPreference(
    userId: string,
    occurrenceId: string,
    input: SetRegistrationPlayPreferenceInput
  ) {
    const now = new Date()
    const [occurrence, registration] = await prisma.$transaction([
      prisma.sessionOccurrence.findUnique({
        where: { id: occurrenceId },
        include: { session: true }
      }),
      prisma.sessionRegistration.findUnique({
        where: { userId_occurrenceId: { userId, occurrenceId } }
      })
    ])

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    if (!registration || registration.status !== 'ATTENDING') {
      throw new Error('User must be attending this session to set play preferences')
    }

    if (occurrence.status === occurrenceStatusCanceled) {
      throw new Error('Session occurrence canceled')
    }

    if (now >= occurrence.endsAt) {
      throw new Error('Session has ended')
    }

    const sessionService = new SessionService()
    const { registrationCloseAt } = sessionService.calculateRegistrationWindow(occurrence.startsAt)
    const sessionDurationMinutes = calculateSessionDurationMinutes(occurrence.startsAt, occurrence.endsAt)
    if (sessionDurationMinutes <= 0) {
      throw new Error('Session duration invalid')
    }

    const currentOwnSegment = buildOwnSegment(
      registration.playMode,
      registration.playSegmentSide,
      registration.playMinutes,
      sessionDurationMinutes
    )
    const currentOwnMinutes = currentOwnSegment.endOffsetMinutes - currentOwnSegment.startOffsetMinutes

    const nextMode = input.mode
    const nextSide = nextMode === 'PARTIAL' ? (input.side ?? null) : null
    const nextMinutes = nextMode === 'PARTIAL' ? (input.minutes ?? null) : null
    if (
      nextMode === 'PARTIAL' &&
      (nextSide === null ||
        nextMinutes === null ||
        !isThirtyMinuteBlock(nextMinutes) ||
        nextMinutes >= sessionDurationMinutes)
    ) {
      throw new Error('Partial play preference must include side and 30-minute block minutes less than session duration')
    }

    const nextOwnSegment = buildOwnSegment(nextMode, nextSide, nextMinutes, sessionDurationMinutes)
    const nextOwnMinutes = nextOwnSegment.endOffsetMinutes - nextOwnSegment.startOffsetMinutes

    if (now > registrationCloseAt && nextOwnMinutes > currentOwnMinutes) {
      throw new Error('Cannot increase registered play time after registration closes')
    }

    let nextFillTargetRegistrationId: string | null = input.fillTargetRegistrationId ?? null
    if (nextMode !== 'PARTIAL') {
      nextFillTargetRegistrationId = null
    }

    if (nextFillTargetRegistrationId) {
      if (nextFillTargetRegistrationId === registration.id) {
        throw new Error('Cannot fill your own partial slot')
      }

      const targetRegistration = await prisma.sessionRegistration.findUnique({
        where: { id: nextFillTargetRegistrationId },
        select: {
          id: true,
          occurrenceId: true,
          status: true,
          playMode: true,
          playSegmentSide: true,
          playMinutes: true
        }
      })

      if (!targetRegistration || targetRegistration.occurrenceId !== occurrenceId || targetRegistration.status !== 'ATTENDING') {
        throw new Error('Fill target registration missing')
      }

      const targetGapSegment = buildGapSegment(
        targetRegistration.playMode,
        targetRegistration.playSegmentSide,
        targetRegistration.playMinutes,
        sessionDurationMinutes
      )

      if (!targetGapSegment) {
        throw new Error('Fill target must be a registered partial player')
      }

      const targetGapMinutes = targetGapSegment.endOffsetMinutes - targetGapSegment.startOffsetMinutes
      const overlapsTargetGap = segmentsOverlap(nextOwnSegment, targetGapSegment)
      if (overlapsTargetGap || nextOwnMinutes + targetGapMinutes > sessionDurationMinutes) {
        throw new Error('Fill target segment overlaps your own play or exceeds session duration')
      }
    }

    const updatedRegistration = await prisma.sessionRegistration.update({
      where: { id: registration.id },
      data: {
        playMode: nextMode,
        playSegmentSide: nextSide,
        playMinutes: nextMinutes,
        fillTargetRegistrationId: nextFillTargetRegistrationId
      }
    })

    if (shouldRebalanceSubSelection(occurrence, now)) {
      await rebalanceSubSelection(occurrence.id)
    }

    return updatedRegistration
  }
}
