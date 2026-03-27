import type { NotificationKind, RegistrationStatus, SessionOccurrenceStatus, SubSignupStatus, Weekday } from '../../generated/prisma/client.js'
import type { SessionOccurrenceGetPayload } from '../../generated/prisma/models/SessionOccurrence.js'
import { notificationQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import {
  registrationCloseHour,
  registrationOpenHour,
  sessionCapacityDefault,
  sessionsWeekPreviewLeadMinutes
} from '../../shared/constants.js'
import {
  easternTimeZone,
  easternZonedTimeToUtc,
  getEasternDateTimeParts,
  getEasternWallClockTimestamp,
  getEasternWeekRangeUtc,
  shiftDateByDays
} from '../../shared/time.js'
import { resolveProfileImageUrl } from '../../integrations/cloudflare/profileImageUrl.js'

const liveOpenHour = 10
const liveOpenMinute = 0
const liveOpenSecond = 0
const liveOpenMillisecond = 0
const logSessionSummaryWithoutAssignment = 'Mapping session occurrence summary without assignment context'
const logLoadedSessionAssignmentStatus = 'Loaded session assignment status for sessions week'
const logResolvedSessionAssignmentStatus = 'Resolved session assignment status'
const logResolvedSessionDisplayStates = 'Resolved session display states'
const logResolvedSessionDisplayStateComparison = 'Resolved session display state comparison'
const logLoadedUserSessionStatuses = 'Loaded user registration/sub statuses'
const logResolvedRegistrationWindow = 'Resolved registration window check'
const logResolvedSubSignupWindow = 'Resolved sub signup window check'
const logLoadedUserSubSignupStatuses = 'Loaded user sub signup statuses'
const logFilteredUserSubSignupStatuses = 'Filtered user sub signup statuses to summary statuses'
const logLoadedSummarySubSignupCounts = 'Loaded summary sub signup counts'
const logLoadedAttendingRegistrationCounts = 'Loaded attending registration counts'
const logCanceledSessionOccurrence = 'Canceled session occurrence'
const logSessionCancellationNotificationsQueued = 'Queued session cancellation notifications'
const localeEnUs = 'en-US'
const sessionCancellationTimeZoneLabel = 'ET'
const sessionCanceledNotificationTitle = 'Session canceled'
const sessionCanceledNotificationKind: NotificationKind = 'SESSION_CANCELED'
const notificationChannelPush = 'PUSH'
const notificationStatusPending = 'PENDING'
const sessionCanceledJobName = 'session-canceled'
const sessionCanceledJobIdPrefix = 'session-canceled'
const sessionCanceledJobIdSeparator = '-'
const sessionOccurrenceStatusCanceled: SessionOccurrenceStatus = 'CANCELED'
const registrationStatusAttending: RegistrationStatus = 'ATTENDING'
const subSignupStatusActive: SubSignupStatus = 'ACTIVE'
const subSignupStatusSelected: SubSignupStatus = 'SELECTED'
const subSignupStatusReplaced: SubSignupStatus = 'REPLACED'
const subSignupStatusCanceled: SubSignupStatus = 'CANCELED'
const leagueMembershipStatusActive = 'ACTIVE'
const subSignupSummaryStatuses: SubSignupStatus[] = [subSignupStatusActive, subSignupStatusSelected]
const millisecondsPerMinute = 60_000
const nextDayOffset = 1
const dayEndHour = 23
const dayEndMinute = 59
const dayEndSecond = 59
const dayEndMillisecond = 999
const logFilteredSessionsWeekForPreviewWindow = 'Filtered sessions week for monday preview window'
const subSignupStatusCountsInitial: Record<SubSignupStatus, number> = {
  ACTIVE: 0,
  SELECTED: 0,
  REPLACED: 0,
  CANCELED: 0
}

export type SessionWindow = {
  registrationOpenAt: Date
  registrationCloseAt: Date
  subSignupCloseAt: Date
}

export type SessionDisplayState = 'PAST' | 'LIVE' | 'UPCOMING'

type SessionOccurrenceSummary = {
  id: string
  sessionId: string
  occurrenceStatus: SessionOccurrenceStatus
  title: string
  weekday: Weekday
  startTimeMinutes: number
  endTimeMinutes: number
  startTime: Date
  endTime: Date
  capacity: number
  registrationOpenAt: Date
  registrationCloseAt: Date
  registrationStatus: RegistrationStatus | null
  subSignupStatus: SubSignupStatus | null
  isUserAssignedToSession: boolean
  attendingCount: number
  subCount: number
  registeredUsers: SessionParticipantSummary[]
  subUsers: SessionParticipantSummary[]
  displayState: SessionDisplayState
  liveOpensAt: Date
}

type SessionParticipantSummary = {
  id: string
  displayName: string | null
  profileImageUrl: string | null
}

type SessionRosterEntry = {
  user: {
    id: string
    phoneNumber: string
    displayName: string | null
    profileImageId?: string | null
    isOnApp: boolean
    roleContextLeagueId?: string
  }
  status: string
  selectionRank?: number | null
}

type SessionOccurrenceDetail = {
  occurrenceId: string
  attendees: SessionRosterEntry[]
  subs: SessionRosterEntry[]
  openSpots: number
  registrationOpenAt: Date
  registrationCloseAt: Date
  canRegister: boolean
  canSub: boolean
  isRegistrationOpen: boolean
  isUserAssignedToSession: boolean
}

type OccurrenceWithSession = SessionOccurrenceGetPayload<{
  include: {
    session: true
    _count: { select: { registrations: true; subSignups: true } }
  }
}>

const sessionCancellationTimeFormat = new Intl.DateTimeFormat(localeEnUs, {
  timeZone: easternTimeZone,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

const formatSessionCancellationDate = (startsAt: Date): string =>
  `${sessionCancellationTimeFormat.format(startsAt)} ${sessionCancellationTimeZoneLabel}`

const buildSessionCanceledNotificationBody = (sessionTitle: string, startsAt: Date): string => {
  const formattedDate = formatSessionCancellationDate(startsAt)
  return `${sessionTitle} on ${formattedDate} has been canceled.`
}

const calculateLiveOpensAt = (startsAt: Date): Date => {
  const startsAtParts = getEasternDateTimeParts(startsAt)
  const startDateParts = {
    year: startsAtParts.year,
    month: startsAtParts.month,
    day: startsAtParts.day
  }
  const dayBeforeParts = shiftDateByDays(startDateParts, -1)

  return easternZonedTimeToUtc({
    ...dayBeforeParts,
    hour: liveOpenHour,
    minute: liveOpenMinute,
    second: liveOpenSecond,
    millisecond: liveOpenMillisecond
  })
}

const calculateSubSignupCloseAt = (endsAt: Date): Date => {
  const endsAtParts = getEasternDateTimeParts(endsAt)
  return easternZonedTimeToUtc({
    year: endsAtParts.year,
    month: endsAtParts.month,
    day: endsAtParts.day,
    hour: endsAtParts.hour,
    minute: endsAtParts.minute,
    second: endsAtParts.second,
    millisecond: 0
  })
}

const getSessionDisplayState = (now: Date, endsAt: Date, liveOpensAt: Date): SessionDisplayState => {
  const nowEasternTimestamp = getEasternWallClockTimestamp(now)
  const endsAtEasternTimestamp = getEasternWallClockTimestamp(endsAt)
  const liveOpensAtEasternTimestamp = getEasternWallClockTimestamp(liveOpensAt)
  logger.info(
    {
      now,
      endsAt,
      liveOpensAt,
      nowEasternTimestamp,
      endsAtEasternTimestamp,
      liveOpensAtEasternTimestamp
    },
    logResolvedSessionDisplayStateComparison
  )

  if (endsAtEasternTimestamp <= nowEasternTimestamp) {
    return 'PAST'
  }

  if (nowEasternTimestamp >= liveOpensAtEasternTimestamp) {
    return 'LIVE'
  }

  return 'UPCOMING'
}

const appendParticipantByOccurrence = (
  participantsByOccurrenceId: Map<string, SessionParticipantSummary[]>,
  occurrenceId: string,
  userId: string,
  displayName: string | null,
  profileImageId: string | null
): void => {
  const normalizedDisplayName = displayName?.trim() || null
  const participant: SessionParticipantSummary = {
    id: userId,
    displayName: normalizedDisplayName,
    profileImageUrl: resolveProfileImageUrl(profileImageId)
  }
  const existingParticipants = participantsByOccurrenceId.get(occurrenceId)
  if (existingParticipants) {
    existingParticipants.push(participant)
    return
  }

  participantsByOccurrenceId.set(occurrenceId, [participant])
}


/**
 * SessionService
 * - Lists sessions with derived registration windows.
 * - Maps occurrence-level detail and counters for member/admin queries.
 * - Used by session queries, registration/sub eligibility checks, and admin occurrence workflows.
 */
export class SessionService {
  public calculateRegistrationWindow(startsAt: Date): SessionWindow {
    const startsAtParts = getEasternDateTimeParts(startsAt)
    const startDateParts = {
      year: startsAtParts.year,
      month: startsAtParts.month,
      day: startsAtParts.day
    }
    const dayBeforeParts = shiftDateByDays(startDateParts, -1)

    const openAt = easternZonedTimeToUtc({
      ...dayBeforeParts,
      hour: registrationOpenHour,
      minute: 0,
      second: 0,
      millisecond: 0
    })

    const closeAt = easternZonedTimeToUtc({
      ...dayBeforeParts,
      hour: registrationCloseHour,
      minute: 0,
      second: 0,
      millisecond: 0
    })
    const subSignupCloseAt = calculateSubSignupCloseAt(startsAt)

    return { registrationOpenAt: openAt, registrationCloseAt: closeAt, subSignupCloseAt }
  }

  public isWithinRegistrationWindow(now: Date, startsAt: Date): boolean {
    const { registrationOpenAt, registrationCloseAt } = this.calculateRegistrationWindow(startsAt)
    const isOpen = now >= registrationOpenAt && now <= registrationCloseAt
    logger.info(
      {
        now,
        startsAt,
        registrationOpenAt,
        registrationCloseAt,
        isOpen
      },
      logResolvedRegistrationWindow
    )
    return isOpen
  }

  public isWithinSubSignupWindow(now: Date, endsAt: Date): boolean {
    const subSignupCloseAt = calculateSubSignupCloseAt(endsAt)
    const isOpen = now <= subSignupCloseAt
    logger.info(
      {
        now,
        endsAt,
        subSignupCloseAt,
        isOpen
      },
      logResolvedSubSignupWindow
    )
    return isOpen
  }
  /**
   * Lists session occurrences for the current Eastern week.
   * - Computes Monday 00:00 through Sunday 23:59:59.999 (Eastern).
   * - Extends query bounds through next Monday end-of-day (Eastern) for preview eligibility.
   * - Includes out-of-week rows only when now is within 2 hours of registration open.
   * - Used by the sessionsWeek query.
   */
  public async listSessionsWeek(
    leagueId: string,
    userId?: string | null
  ): Promise<SessionOccurrenceSummary[]> {
    const now = new Date()
    const { start, end } = getEasternWeekRangeUtc(now)
    const weekEndParts = getEasternDateTimeParts(end)
    const nextMondayDateParts = shiftDateByDays(
      {
        year: weekEndParts.year,
        month: weekEndParts.month,
        day: weekEndParts.day
      },
      nextDayOffset
    )
    const extendedEnd = easternZonedTimeToUtc({
      ...nextMondayDateParts,
      hour: dayEndHour,
      minute: dayEndMinute,
      second: dayEndSecond,
      millisecond: dayEndMillisecond
    })
    logger.info({ start, end, extendedEnd, timeZone: easternTimeZone }, 'Listing sessions for eastern week')
    const summaries = await this.listSessions(start, extendedEnd, leagueId, userId)
    const previewLeadMilliseconds = sessionsWeekPreviewLeadMinutes * millisecondsPerMinute
    const filteredSummaries = summaries.filter((summary) => {
      const isWithinWeekRange = summary.startTime >= start && summary.startTime <= end
      if (isWithinWeekRange) {
        return true
      }

      const previewAvailableAt = new Date(summary.registrationOpenAt.getTime() - previewLeadMilliseconds)
      return now >= previewAvailableAt
    })
    logger.info(
      {
        weekStart: start,
        weekEnd: end,
        fetchedCount: summaries.length,
        returnedCount: filteredSummaries.length,
        previewLeadMinutes: sessionsWeekPreviewLeadMinutes
      },
      logFilteredSessionsWeekForPreviewWindow
    )

    return filteredSummaries
  }

  public async listSessions(
    start: Date,
    end: Date,
    leagueId: string,
    userId?: string | null
  ): Promise<SessionOccurrenceSummary[]> {
    const includeUserStatus = typeof userId === 'string' && userId.length > 0
    const now = new Date()
    const occurrences = await prisma.sessionOccurrence.findMany({
      where: {
        startsAt: { gte: start },
        endsAt: { lte: end },
        session: { leagueId }
      },
      include: {
        session: true,
        _count: { select: { registrations: true, subSignups: true } }
      },
      orderBy: { startsAt: 'asc' }
    })

    const attendingCountByOccurrenceId = new Map<string, number>()
    const summarySubCountByOccurrenceId = new Map<string, number>()
    const registeredUsersByOccurrenceId = new Map<string, SessionParticipantSummary[]>()
    const subUsersByOccurrenceId = new Map<string, SessionParticipantSummary[]>()
    if (occurrences.length > 0) {
      const occurrenceIds = occurrences.map((occurrence) => occurrence.id)
      const [attendingCounts, summarySubCounts, attendingRegistrations, summarySubSignups] = await Promise.all([
        prisma.sessionRegistration.groupBy({
          by: ['occurrenceId'],
          where: {
            occurrenceId: { in: occurrenceIds },
            status: registrationStatusAttending
          },
          _count: { _all: true }
        }),
        prisma.subSignup.groupBy({
          by: ['occurrenceId'],
          where: {
            occurrenceId: { in: occurrenceIds },
            status: { in: subSignupSummaryStatuses }
          },
          _count: { _all: true }
        }),
        prisma.sessionRegistration.findMany({
          where: {
            occurrenceId: { in: occurrenceIds },
            status: registrationStatusAttending
          },
          select: {
            occurrenceId: true,
            user: { select: { id: true, displayName: true, profileImageId: true } }
          },
          orderBy: { createdAt: 'asc' }
        }),
        prisma.subSignup.findMany({
          where: {
            occurrenceId: { in: occurrenceIds },
            status: { in: subSignupSummaryStatuses }
          },
          select: {
            occurrenceId: true,
            user: { select: { id: true, displayName: true, profileImageId: true } }
          },
          orderBy: { signedUpAt: 'asc' }
        })
      ])

      attendingCounts.forEach((countEntry) => {
        attendingCountByOccurrenceId.set(countEntry.occurrenceId, countEntry._count._all)
      })
      logger.info(
        { occurrenceCount: occurrences.length, attendingRegistrationCounts: attendingCounts.length },
        logLoadedAttendingRegistrationCounts
      )

      summarySubCounts.forEach((countEntry) => {
        summarySubCountByOccurrenceId.set(countEntry.occurrenceId, countEntry._count._all)
      })
      logger.info(
        { occurrenceCount: occurrences.length, summarySubSignupCounts: summarySubCounts.length, subSignupSummaryStatuses },
        logLoadedSummarySubSignupCounts
      )

      attendingRegistrations.forEach((registration) => {
        appendParticipantByOccurrence(
          registeredUsersByOccurrenceId,
          registration.occurrenceId,
          registration.user.id,
          registration.user.displayName,
          registration.user.profileImageId
        )
      })
      summarySubSignups.forEach((subSignup) => {
        appendParticipantByOccurrence(
          subUsersByOccurrenceId,
          subSignup.occurrenceId,
          subSignup.user.id,
          subSignup.user.displayName,
          subSignup.user.profileImageId
        )
      })
    }

    const assignedSessionIds = new Set<string>()
    const registrationStatusByOccurrenceId = new Map<string, RegistrationStatus>()
    const subSignupStatusByOccurrenceId = new Map<string, SubSignupStatus>()
    if (includeUserStatus) {
      const occurrenceIds = occurrences.map((occurrence) => occurrence.id)
      const sessionIds = Array.from(new Set(occurrences.map((occurrence) => occurrence.sessionId)))
      if (sessionIds.length > 0) {
        const assignments = await prisma.slotAssignment.findMany({
          where: { userId: userId as string, sessionId: { in: sessionIds } },
          select: { sessionId: true }
        })
        assignments.forEach((assignment) => assignedSessionIds.add(assignment.sessionId))
      }
      if (occurrenceIds.length > 0) {
        const [registrations, subSignups] = await Promise.all([
          prisma.sessionRegistration.findMany({
            where: { userId: userId as string, occurrenceId: { in: occurrenceIds } },
            select: { occurrenceId: true, status: true }
          }),
          prisma.subSignup.findMany({
            where: {
              userId: userId as string,
              occurrenceId: { in: occurrenceIds },
              status: { in: subSignupSummaryStatuses }
            },
            select: { occurrenceId: true, status: true }
          })
        ])
        registrations.forEach((registration) => {
          registrationStatusByOccurrenceId.set(registration.occurrenceId, registration.status)
        })
        subSignups.forEach((signup) => {
          subSignupStatusByOccurrenceId.set(signup.occurrenceId, signup.status)
        })
        const subSignupStatusCounts = subSignups.reduce<Record<SubSignupStatus, number>>(
          (counts, signup) => {
            counts[signup.status] = (counts[signup.status] ?? 0) + 1
            return counts
          },
          { ...subSignupStatusCountsInitial }
        )
        logger.info(
          {
            userId,
            registrationCount: registrations.length,
            subSignupCount: subSignups.length
          },
          logLoadedUserSessionStatuses
        )
        logger.info(
          {
            userId,
            allowedStatuses: subSignupSummaryStatuses,
            filteredOutStatuses: [subSignupStatusCanceled, subSignupStatusReplaced]
          },
          logFilteredUserSubSignupStatuses
        )
        logger.info({ userId, subSignupStatusCounts }, logLoadedUserSubSignupStatuses)
      }
      logger.info(
        { userId, sessionCount: sessionIds.length, assignedSessionCount: assignedSessionIds.size },
        logLoadedSessionAssignmentStatus
      )
    }

    const summaries = occurrences.map((occurrence: (typeof occurrences)[number]) => {
      const attendingCount = attendingCountByOccurrenceId.get(occurrence.id) ?? 0
      const registeredUsers = registeredUsersByOccurrenceId.get(occurrence.id) ?? []
      const subUsers = subUsersByOccurrenceId.get(occurrence.id) ?? []
      if (includeUserStatus) {
        const typedOccurrence = occurrence as OccurrenceWithSession
        const registrationStatus = registrationStatusByOccurrenceId.get(typedOccurrence.id) ?? null
        const subSignupStatus = subSignupStatusByOccurrenceId.get(typedOccurrence.id) ?? null
        const isUserAssignedToSession = assignedSessionIds.has(typedOccurrence.sessionId)

        const summarySubCount = summarySubCountByOccurrenceId.get(typedOccurrence.id) ?? 0
        return this.mapOccurrenceToSummary(
          typedOccurrence,
          registrationStatus,
          subSignupStatus,
          isUserAssignedToSession,
          attendingCount,
          summarySubCount,
          registeredUsers,
          subUsers,
          now
        )
      }

      const summarySubCount = summarySubCountByOccurrenceId.get(occurrence.id) ?? 0
      return this.mapOccurrenceToSummary(
        occurrence as OccurrenceWithSession,
        null,
        null,
        false,
        attendingCount,
        summarySubCount,
        registeredUsers,
        subUsers,
        now
      )
    })

    const displayStateCounts = summaries.reduce<Record<SessionDisplayState, number>>(
      (counts, summary) => {
        counts[summary.displayState] += 1
        return counts
      },
      { PAST: 0, LIVE: 0, UPCOMING: 0 }
    )
    logger.info({ displayStateCounts }, logResolvedSessionDisplayStates)

    return summaries
  }

  public async createSessionOccurrence(
    sessionId: string,
    startsAt: Date,
    endsAt: Date
  ): Promise<SessionOccurrenceSummary> {
    const occurrence = await prisma.sessionOccurrence.create({
      data: {
        session: { connect: { id: sessionId } },
        startsAt,
        endsAt
      }
    })

    logger.info({ occurrenceId: occurrence.id, sessionId }, 'Created session occurrence')
    return this.getOccurrenceSummary(occurrence.id)
  }

  public async cancelSessionOccurrence(occurrenceId: string): Promise<SessionOccurrenceSummary> {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { session: true }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const canceledOccurrence =
      occurrence.status === sessionOccurrenceStatusCanceled
        ? occurrence
        : await prisma.sessionOccurrence.update({
            where: { id: occurrenceId },
            data: { status: sessionOccurrenceStatusCanceled },
            include: { session: true }
          })

    if (occurrence.status !== sessionOccurrenceStatusCanceled) {
      logger.info({ occurrenceId, sessionId: canceledOccurrence.sessionId }, logCanceledSessionOccurrence)
    }

    const assignments = await prisma.slotAssignment.findMany({
      where: { sessionId: canceledOccurrence.sessionId },
      select: { userId: true }
    })
    const assignedUserIds = Array.from(new Set(assignments.map((assignment) => assignment.userId)))
    if (assignedUserIds.length === 0) {
      return this.getOccurrenceSummary(occurrenceId)
    }

    const existingNotifications = await prisma.notification.findMany({
      where: {
        occurrenceId,
        userId: { in: assignedUserIds },
        kind: sessionCanceledNotificationKind
      },
      select: { userId: true }
    })
    const existingNotificationUserIds = new Set(existingNotifications.map((notification) => notification.userId))
    const usersWithoutCancellationNotification = assignedUserIds.filter((userId) => !existingNotificationUserIds.has(userId))
    if (usersWithoutCancellationNotification.length > 0) {
      const notificationBody = buildSessionCanceledNotificationBody(canceledOccurrence.session.title, canceledOccurrence.startsAt)
      await prisma.notification.createMany({
        data: usersWithoutCancellationNotification.map((userId) => ({
          userId,
          occurrenceId,
          title: sessionCanceledNotificationTitle,
          body: notificationBody,
          channel: notificationChannelPush,
          status: notificationStatusPending,
          kind: sessionCanceledNotificationKind,
          payload: { sessionId: canceledOccurrence.sessionId }
        }))
      })
    }

    const pendingNotifications = await prisma.notification.findMany({
      where: {
        occurrenceId,
        userId: { in: assignedUserIds },
        kind: sessionCanceledNotificationKind,
        status: notificationStatusPending
      },
      select: { id: true, userId: true }
    })

    if (pendingNotifications.length === 0) {
      return this.getOccurrenceSummary(occurrenceId)
    }

    const devices = await prisma.userDevice.findMany({
      where: { userId: { in: assignedUserIds } },
      select: { userId: true, token: true }
    })
    const deviceTokensByUserId = new Map<string, string[]>()
    for (const device of devices) {
      const existingTokens = deviceTokensByUserId.get(device.userId) ?? []
      existingTokens.push(device.token)
      deviceTokensByUserId.set(device.userId, existingTokens)
    }

    let queuedCount = 0
    let skippedExistingJobCount = 0
    for (const notification of pendingNotifications) {
      const deviceTokens = deviceTokensByUserId.get(notification.userId) ?? []
      if (deviceTokens.length === 0) {
        continue
      }

      const jobId = `${sessionCanceledJobIdPrefix}${sessionCanceledJobIdSeparator}${notification.id}`
      const existingJob = await notificationQueue.getJob(jobId)

      if (existingJob) {
        skippedExistingJobCount += 1
        continue
      }

      await notificationQueue.add(
        sessionCanceledJobName,
        {
          notificationId: notification.id,
          deviceTokens
        },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: true
        }
      )
      queuedCount += 1
    }

    logger.info(
      {
        occurrenceId,
        assignedCount: assignedUserIds.length,
        pendingNotificationCount: pendingNotifications.length,
        createdNotificationCount: usersWithoutCancellationNotification.length,
        skippedExistingJobCount,
        queuedCount
      },
      logSessionCancellationNotificationsQueued
    )
    return this.getOccurrenceSummary(occurrenceId)
  }

  public async getOccurrenceSummary(occurrenceId: string): Promise<SessionOccurrenceSummary> {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        session: true,
        _count: { select: { registrations: true, subSignups: true } }
      }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const [attendingCount, summarySubCount, attendingRegistrations, summarySubSignups] = await Promise.all([
      prisma.sessionRegistration.count({
        where: { occurrenceId, status: registrationStatusAttending }
      }),
      prisma.subSignup.count({
        where: { occurrenceId, status: { in: subSignupSummaryStatuses } }
      }),
      prisma.sessionRegistration.findMany({
        where: { occurrenceId, status: registrationStatusAttending },
        select: { user: { select: { id: true, displayName: true, profileImageId: true } } },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.subSignup.findMany({
        where: { occurrenceId, status: { in: subSignupSummaryStatuses } },
        select: { user: { select: { id: true, displayName: true, profileImageId: true } } },
        orderBy: { signedUpAt: 'asc' }
      })
    ])
    const registeredUsers = attendingRegistrations.map((registration) => ({
      id: registration.user.id,
      displayName: registration.user.displayName?.trim() || null,
      profileImageUrl: resolveProfileImageUrl(registration.user.profileImageId)
    }))
    const subUsers = summarySubSignups.map((subSignup) => ({
      id: subSignup.user.id,
      displayName: subSignup.user.displayName?.trim() || null,
      profileImageUrl: resolveProfileImageUrl(subSignup.user.profileImageId)
    }))
    const isUserAssignedToSession = false
    logger.info({ occurrenceId, isUserAssignedToSession }, logSessionSummaryWithoutAssignment)
    return this.mapOccurrenceToSummary(
      occurrence,
      null,
      null,
      isUserAssignedToSession,
      attendingCount,
      summarySubCount,
      registeredUsers,
      subUsers,
      new Date()
    )
  }

  public async getOccurrenceDetail(
    occurrenceId: string,
    userId?: string | null
  ): Promise<SessionOccurrenceDetail> {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        session: true,
        registrations: {
          where: { status: registrationStatusAttending },
          include: { user: true },
          orderBy: { createdAt: 'asc' }
        },
        subSignups: {
          where: { status: { in: [subSignupStatusActive, subSignupStatusSelected, subSignupStatusReplaced] } },
          include: { user: true },
          orderBy: { signedUpAt: 'asc' }
        }
      }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const registrationWindow = this.calculateRegistrationWindow(occurrence.startsAt)
    const now = new Date()
    const isRegistrationOpen = now >= registrationWindow.registrationOpenAt && now <= registrationWindow.registrationCloseAt

    const attendeeEntries: SessionRosterEntry[] = occurrence.registrations.map((registration) => ({
      user: {
        id: registration.user.id,
        phoneNumber: registration.user.phoneNumber,
        displayName: registration.user.displayName,
        profileImageId: registration.user.profileImageId,
        isOnApp: registration.user.isOnApp,
        roleContextLeagueId: occurrence.session.leagueId
      },
      status: registration.status
    }))

    const subEntries: SessionRosterEntry[] = occurrence.subSignups.map((signup) => ({
      user: {
        id: signup.user.id,
        phoneNumber: signup.user.phoneNumber,
        displayName: signup.user.displayName,
        profileImageId: signup.user.profileImageId,
        isOnApp: signup.user.isOnApp,
        roleContextLeagueId: occurrence.session.leagueId
      },
      status: signup.status,
      selectionRank: signup.selectionRank
    }))

    const capacity = occurrence.session.capacity ?? sessionCapacityDefault
    const openSpots = Math.max(capacity - occurrence.registrations.length, 0)

    let canRegister = false
    let canSub = false

    if (userId) {
      const [leagueMembership, assignment, hasRegistration, hasSubSignup] =
        await prisma.$transaction([
          prisma.leagueMembership.findUnique({
            where: {
              leagueId_userId: {
                leagueId: occurrence.session.leagueId,
                userId
              }
            },
            select: {
              status: true
            }
          }),
          prisma.slotAssignment.findUnique({
            where: {
              leagueId_userId: {
                leagueId: occurrence.session.leagueId,
                userId
              }
            }
          }),
          prisma.sessionRegistration.findFirst({
            where: { userId, occurrenceId, status: registrationStatusAttending }
          }),
          prisma.subSignup.findFirst({
            where: { userId, occurrenceId, status: { in: [subSignupStatusActive, subSignupStatusSelected] } }
          })
        ])

      const hasActiveLeagueMembership =
        leagueMembership?.status === leagueMembershipStatusActive
      const isUserAssignedToSession =
        assignment?.sessionId === occurrence.sessionId

      canRegister = Boolean(
        hasActiveLeagueMembership && isUserAssignedToSession && !hasRegistration
      )
      canSub = Boolean(
        hasActiveLeagueMembership && !isUserAssignedToSession && !hasSubSignup
      )
      logger.info({ occurrenceId, userId, isUserAssignedToSession }, logResolvedSessionAssignmentStatus)

      return {
        occurrenceId,
        attendees: attendeeEntries,
        subs: subEntries,
        openSpots,
        registrationOpenAt: registrationWindow.registrationOpenAt,
        registrationCloseAt: registrationWindow.registrationCloseAt,
        canRegister,
        canSub,
        isRegistrationOpen,
        isUserAssignedToSession
      }
    }

    return {
      occurrenceId,
      attendees: attendeeEntries,
      subs: subEntries,
      openSpots,
      registrationOpenAt: registrationWindow.registrationOpenAt,
      registrationCloseAt: registrationWindow.registrationCloseAt,
      canRegister,
      canSub,
      isRegistrationOpen,
      isUserAssignedToSession: false
    }
  }

  private mapOccurrenceToSummary(
    occurrence: OccurrenceWithSession,
    registrationStatus: RegistrationStatus | null,
    subSignupStatus: SubSignupStatus | null,
    isUserAssignedToSession: boolean,
    attendingCount: number,
    summarySubCount: number,
    registeredUsers: SessionParticipantSummary[],
    subUsers: SessionParticipantSummary[],
    now: Date
  ): SessionOccurrenceSummary {
    const liveOpensAt = calculateLiveOpensAt(occurrence.startsAt)
    const displayState = getSessionDisplayState(now, occurrence.endsAt, liveOpensAt)
    return {
      id: occurrence.id,
      sessionId: occurrence.sessionId,
      occurrenceStatus: occurrence.status,
      title: occurrence.session.title,
      weekday: occurrence.session.weekday,
      startTimeMinutes: occurrence.session.startTimeMinutes,
      endTimeMinutes: occurrence.session.endTimeMinutes,
      startTime: occurrence.startsAt,
      endTime: occurrence.endsAt,
      capacity: occurrence.session.capacity ?? sessionCapacityDefault,
      ...this.calculateRegistrationWindow(occurrence.startsAt),
      registrationStatus,
      subSignupStatus,
      isUserAssignedToSession,
      attendingCount,
      subCount: summarySubCount,
      registeredUsers,
      subUsers,
      displayState,
      liveOpensAt
    }
  }
}
