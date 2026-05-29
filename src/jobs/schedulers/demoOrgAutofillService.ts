import { randomInt } from 'node:crypto'

import { RegistrationService } from '../../features/registrations/registrationService.js'
import { SessionService } from '../../features/sessions/sessionService.js'
import { SubSignupService } from '../../features/subs/subSignupService.js'
import type { SubSignupStatus } from '../../generated/prisma/client.js'
import { logger } from '../../shared/logger.js'
import { prisma } from '../../shared/prisma.js'
import { easternZonedTimeToUtc, getEasternDateParts, getEasternDayRangeUtc, shiftDateByDays } from '../../shared/time.js'
import { sessionCapacityDefault } from '../../shared/constants.js'

const demoOrganizationSlug = 'demo-org'
const leagueStatusActive = 'ACTIVE'
const sessionStatusActive = 'ACTIVE'
const occurrenceStatusActive = 'ACTIVE'
const registrationStatusAttending = 'ATTENDING'
const subSignupStatusActive = 'ACTIVE'
const subSignupStatusSelected = 'SELECTED'
const activeSubSignupStatuses: SubSignupStatus[] = [
  subSignupStatusActive,
  subSignupStatusSelected
]
const leagueMembershipStatusActive = 'ACTIVE'
const registrationFillMinimumRatio = 0.5
const registrationFillMaximumRatio = 0.8
const maxAutoSubSignupsPerTickPerOccurrence = 1
const maxAutoSubSignupsPerOccurrence = 8
const sortOrderAscending = 'asc'
const logNoOpenOccurrencesForDemoOrgAutofill = 'No open demo-org occurrences eligible for autofill'
const logProcessedDemoOrgOccurrenceAutofill = 'Processed demo-org occurrence autofill'
const logCompletedDemoOrgAutofillTick = 'Completed demo-org autofill tick'
const logDemoOrgAutofillRegistrationAttemptFailed = 'Demo org autofill registration attempt failed'
const logDemoOrgAutofillSubSignupAttemptFailed = 'Demo org autofill sub signup attempt failed'
const dayStartHour = 0
const dayStartMinute = 0
const dayStartSecond = 0
const dayStartMillisecond = 0

type ScopedOccurrence = {
  id: string
  sessionId: string
  startsAt: Date
  session: {
    leagueId: string
    capacity: number
  }
}

type RegistrationSkipReason =
  | 'existing-attendees'
  | 'no-assigned-candidates'
  | 'zero-target'
  | null

type SubSkipReason = 'sub-cap-reached' | 'no-sub-candidates' | null

type RegistrationAutofillOutcome = {
  attemptedCount: number
  succeededCount: number
  failedCount: number
  existingAttendingCount: number
  targetCount: number
  skippedReason: RegistrationSkipReason
}

type SubAutofillOutcome = {
  attemptedCount: number
  succeededCount: number
  failedCount: number
  existingActiveSelectedCount: number
  skippedReason: SubSkipReason
}

/**
 * DemoOrgAutofillService
 * - Runs scheduler-tick autofill behavior for demo-org active leagues only.
 * - Auto-registers assigned users for open occurrences that currently have no attendees.
 * - Auto-signs up at most one sub per tick while respecting per-occurrence sub caps.
 */
export class DemoOrgAutofillService {
  private sessionService = new SessionService()
  private registrationService = new RegistrationService()
  private subSignupService = new SubSignupService()

  /**
   * Executes one demo-org autofill pass against registration-open occurrences.
   */
  public async runDemoOrgAutofillTick(now: Date): Promise<void> {
    const scopedOccurrenceStartsAtRange = this.resolveScopedOccurrenceStartsAtRange(now)
    const scopedOccurrences = await prisma.sessionOccurrence.findMany({
      where: {
        status: occurrenceStatusActive,
        startsAt: {
          gte: scopedOccurrenceStartsAtRange.start,
          lt: scopedOccurrenceStartsAtRange.endExclusive
        },
        session: {
          status: sessionStatusActive,
          league: {
            status: leagueStatusActive,
            organization: {
              slug: demoOrganizationSlug
            }
          }
        }
      },
      select: {
        id: true,
        sessionId: true,
        startsAt: true,
        session: {
          select: {
            leagueId: true,
            capacity: true
          }
        }
      },
      orderBy: {
        startsAt: sortOrderAscending
      }
    })
    const openOccurrences = scopedOccurrences.filter((occurrence) => {
      const registrationWindow = this.sessionService.calculateRegistrationWindow(
        occurrence.startsAt
      )
      return (
        now >= registrationWindow.registrationOpenAt &&
        now <= registrationWindow.registrationCloseAt
      )
    })

    if (openOccurrences.length === 0) {
      logger.info(
        {
          scopedOccurrenceCount: scopedOccurrences.length,
          openOccurrenceCount: 0
        },
        logNoOpenOccurrencesForDemoOrgAutofill
      )
      return
    }

    const registrationSkippedCounts = new Map<Exclude<RegistrationSkipReason, null>, number>()
    const subSkippedCounts = new Map<Exclude<SubSkipReason, null>, number>()
    let registrationAttemptedCount = 0
    let registrationSucceededCount = 0
    let registrationFailedCount = 0
    let subAttemptedCount = 0
    let subSucceededCount = 0
    let subFailedCount = 0

    for (const occurrence of openOccurrences) {
      const [registrationOutcome, subOutcome] = await Promise.all([
        this.autofillRegistrations(occurrence),
        this.autofillSubs(occurrence)
      ])

      registrationAttemptedCount += registrationOutcome.attemptedCount
      registrationSucceededCount += registrationOutcome.succeededCount
      registrationFailedCount += registrationOutcome.failedCount
      subAttemptedCount += subOutcome.attemptedCount
      subSucceededCount += subOutcome.succeededCount
      subFailedCount += subOutcome.failedCount

      if (registrationOutcome.skippedReason) {
        const previousCount =
          registrationSkippedCounts.get(registrationOutcome.skippedReason) ?? 0
        registrationSkippedCounts.set(
          registrationOutcome.skippedReason,
          previousCount + 1
        )
      }

      if (subOutcome.skippedReason) {
        const previousCount = subSkippedCounts.get(subOutcome.skippedReason) ?? 0
        subSkippedCounts.set(subOutcome.skippedReason, previousCount + 1)
      }

      logger.info(
        {
          occurrenceId: occurrence.id,
          registration: registrationOutcome,
          subs: subOutcome
        },
        logProcessedDemoOrgOccurrenceAutofill
      )
    }

    logger.info(
      {
        scopedOccurrenceCount: scopedOccurrences.length,
        openOccurrenceCount: openOccurrences.length,
        registration: {
          attemptedCount: registrationAttemptedCount,
          succeededCount: registrationSucceededCount,
          failedCount: registrationFailedCount,
          skippedByReason: Object.fromEntries(registrationSkippedCounts)
        },
        subs: {
          attemptedCount: subAttemptedCount,
          succeededCount: subSucceededCount,
          failedCount: subFailedCount,
          skippedByReason: Object.fromEntries(subSkippedCounts)
        }
      },
      logCompletedDemoOrgAutofillTick
    )
  }

  private resolveScopedOccurrenceStartsAtRange(
    now: Date
  ): { start: Date; endExclusive: Date } {
    const nowEasternDateParts = getEasternDateParts(now)
    const nextEasternDateParts = shiftDateByDays(nowEasternDateParts, 1)
    const dayAfterNextEasternDateParts = shiftDateByDays(nextEasternDateParts, 1)

    return {
      start: easternZonedTimeToUtc({
        ...nextEasternDateParts,
        hour: dayStartHour,
        minute: dayStartMinute,
        second: dayStartSecond,
        millisecond: dayStartMillisecond
      }),
      endExclusive: easternZonedTimeToUtc({
        ...dayAfterNextEasternDateParts,
        hour: dayStartHour,
        minute: dayStartMinute,
        second: dayStartSecond,
        millisecond: dayStartMillisecond
      })
    }
  }

  private async autofillRegistrations(
    occurrence: ScopedOccurrence
  ): Promise<RegistrationAutofillOutcome> {
    const existingAttendingCount = await prisma.sessionRegistration.count({
      where: {
        occurrenceId: occurrence.id,
        status: registrationStatusAttending
      }
    })

    if (existingAttendingCount > 0) {
      return {
        attemptedCount: 0,
        succeededCount: 0,
        failedCount: 0,
        existingAttendingCount,
        targetCount: 0,
        skippedReason: 'existing-attendees'
      }
    }

    const capacity = occurrence.session.capacity ?? sessionCapacityDefault
    const minimumTargetCount = Math.ceil(capacity * registrationFillMinimumRatio)
    const maximumTargetCount = Math.floor(capacity * registrationFillMaximumRatio)
    const clampedMaximumTargetCount = Math.max(
      minimumTargetCount,
      maximumTargetCount
    )
    const targetCount = getRandomIntInclusive(
      minimumTargetCount,
      clampedMaximumTargetCount
    )

    if (targetCount <= 0) {
      return {
        attemptedCount: 0,
        succeededCount: 0,
        failedCount: 0,
        existingAttendingCount,
        targetCount,
        skippedReason: 'zero-target'
      }
    }

    const assignmentCandidates = await prisma.slotAssignment.findMany({
      where: {
        leagueId: occurrence.session.leagueId,
        sessionId: occurrence.sessionId,
        user: {
          isOnApp: false
        }
      },
      select: {
        userId: true
      },
      orderBy: [{ createdAt: sortOrderAscending }, { userId: sortOrderAscending }]
    })

    if (assignmentCandidates.length === 0) {
      return {
        attemptedCount: 0,
        succeededCount: 0,
        failedCount: 0,
        existingAttendingCount,
        targetCount,
        skippedReason: 'no-assigned-candidates'
      }
    }

    let attemptedCount = 0
    let succeededCount = 0
    let failedCount = 0

    for (const assignment of assignmentCandidates) {
      if (succeededCount >= targetCount) {
        break
      }

      attemptedCount += 1
      try {
        await this.registrationService.register(assignment.userId, occurrence.id)
        succeededCount += 1
      } catch (error) {
        failedCount += 1
        logger.debug(
          {
            err: error,
            occurrenceId: occurrence.id,
            userId: assignment.userId
          },
          logDemoOrgAutofillRegistrationAttemptFailed
        )
      }
    }

    return {
      attemptedCount,
      succeededCount,
      failedCount,
      existingAttendingCount,
      targetCount,
      skippedReason: null
    }
  }

  private async autofillSubs(occurrence: ScopedOccurrence): Promise<SubAutofillOutcome> {
    const existingActiveSelectedCount = await prisma.subSignup.count({
      where: {
        occurrenceId: occurrence.id,
        status: {
          in: activeSubSignupStatuses
        }
      }
    })

    if (existingActiveSelectedCount >= maxAutoSubSignupsPerOccurrence) {
      return {
        attemptedCount: 0,
        succeededCount: 0,
        failedCount: 0,
        existingActiveSelectedCount,
        skippedReason: 'sub-cap-reached'
      }
    }

    const subCandidateUserIds = await this.resolveSubCandidateUserIds(occurrence)
    if (subCandidateUserIds.length === 0) {
      return {
        attemptedCount: 0,
        succeededCount: 0,
        failedCount: 0,
        existingActiveSelectedCount,
        skippedReason: 'no-sub-candidates'
      }
    }

    let attemptedCount = 0
    let succeededCount = 0
    let failedCount = 0

    for (const userId of subCandidateUserIds) {
      if (succeededCount >= maxAutoSubSignupsPerTickPerOccurrence) {
        break
      }

      const currentActiveSelectedCount = existingActiveSelectedCount + succeededCount
      if (currentActiveSelectedCount >= maxAutoSubSignupsPerOccurrence) {
        break
      }

      attemptedCount += 1
      try {
        await this.subSignupService.signup(userId, occurrence.id)
        succeededCount += 1
      } catch (error) {
        failedCount += 1
        logger.debug(
          {
            err: error,
            occurrenceId: occurrence.id,
            userId
          },
          logDemoOrgAutofillSubSignupAttemptFailed
        )
      }
    }

    return {
      attemptedCount,
      succeededCount,
      failedCount,
      existingActiveSelectedCount,
      skippedReason: null
    }
  }

  private async resolveSubCandidateUserIds(
    occurrence: ScopedOccurrence
  ): Promise<string[]> {
    const [leagueMembers, assignedUsers, existingOccurrenceSubs] = await Promise.all([
      prisma.leagueMembership.findMany({
        where: {
          leagueId: occurrence.session.leagueId,
          status: leagueMembershipStatusActive,
          user: {
            isOnApp: false
          }
        },
        select: {
          userId: true
        },
        orderBy: [{ createdAt: sortOrderAscending }, { userId: sortOrderAscending }]
      }),
      prisma.slotAssignment.findMany({
        where: {
          sessionId: occurrence.sessionId
        },
        select: {
          userId: true
        }
      }),
      prisma.subSignup.findMany({
        where: {
          occurrenceId: occurrence.id,
          status: {
            in: activeSubSignupStatuses
          }
        },
        select: {
          userId: true
        }
      })
    ])

    if (leagueMembers.length === 0) {
      return []
    }

    const assignedUserIdSet = new Set(assignedUsers.map((assignment) => assignment.userId))
    const existingOccurrenceSubUserIdSet = new Set(
      existingOccurrenceSubs.map((signup) => signup.userId)
    )

    const candidateUserIds = leagueMembers
      .map((membership) => membership.userId)
      .filter(
        (userId) =>
          !assignedUserIdSet.has(userId) && !existingOccurrenceSubUserIdSet.has(userId)
      )

    if (candidateUserIds.length === 0) {
      return []
    }

    const dayRange = getEasternDayRangeUtc(occurrence.startsAt)
    const [sameDayRegistrations, sameDaySubSignups] = await Promise.all([
      prisma.sessionRegistration.findMany({
        where: {
          userId: {
            in: candidateUserIds
          },
          status: registrationStatusAttending,
          occurrence: {
            startsAt: {
              gte: dayRange.start,
              lte: dayRange.end
            }
          }
        },
        select: {
          userId: true
        }
      }),
      prisma.subSignup.findMany({
        where: {
          userId: {
            in: candidateUserIds
          },
          status: {
            in: activeSubSignupStatuses
          },
          occurrence: {
            startsAt: {
              gte: dayRange.start,
              lte: dayRange.end
            }
          }
        },
        select: {
          userId: true,
          occurrenceId: true
        }
      })
    ])

    const blockedUserIdSet = new Set<string>()
    sameDayRegistrations.forEach((registration) => {
      blockedUserIdSet.add(registration.userId)
    })
    sameDaySubSignups.forEach((signup) => {
      if (signup.occurrenceId !== occurrence.id) {
        blockedUserIdSet.add(signup.userId)
      }
    })

    return candidateUserIds.filter((userId) => !blockedUserIdSet.has(userId))
  }
}

const getRandomIntInclusive = (minimum: number, maximum: number): number => {
  if (maximum <= minimum) {
    return minimum
  }

  return randomInt(minimum, maximum + 1)
}
