import type { RegistrationStatus, SubSignupStatus, Weekday } from '../../generated/prisma/client.js'
import type { SessionOccurrenceGetPayload } from '../../generated/prisma/models/SessionOccurrence.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { registrationCloseHour, registrationOpenHour, sessionCapacityDefault } from '../../shared/constants.js'
import {
  easternTimeZone,
  easternZonedTimeToUtc,
  getEasternDateTimeParts,
  getEasternWallClockTimestamp,
  getEasternWeekRangeUtc,
  shiftDateByDays
} from '../../shared/time.js'

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
const logFilteredUserSubSignupStatuses = 'Filtered user sub signup statuses to active'
const logLoadedActiveSubSignupCounts = 'Loaded active sub signup counts'
const logLoadedAttendingRegistrationCounts = 'Loaded attending registration counts'
const registrationStatusAttending: RegistrationStatus = 'ATTENDING'
const subSignupStatusActive: SubSignupStatus = 'ACTIVE'
const subSignupStatusSelected: SubSignupStatus = 'SELECTED'
const subSignupStatusReplaced: SubSignupStatus = 'REPLACED'
const subSignupStatusCanceled: SubSignupStatus = 'CANCELED'
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
    role: string
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
  displayName: string | null
): void => {
  const normalizedDisplayName = displayName?.trim() || null
  const participant: SessionParticipantSummary = {
    id: userId,
    displayName: normalizedDisplayName,
    profileImageUrl: null
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
 * - Creates sessions tied to the default league.
 * - Used by session queries and admin mutations.
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
   * - Delegates to range-based listing for the resulting UTC window.
   * - Used by the sessionsWeek query.
   */
  public async listSessionsWeek(userId?: string | null): Promise<SessionOccurrenceSummary[]> {
    const { start, end } = getEasternWeekRangeUtc(new Date())
    logger.info({ start, end, timeZone: easternTimeZone }, 'Listing sessions for eastern week')
    return this.listSessions(start, end, userId)
  }

  public async listSessions(start: Date, end: Date, userId?: string | null): Promise<SessionOccurrenceSummary[]> {
    const includeUserStatus = typeof userId === 'string' && userId.length > 0
    const now = new Date()
    const occurrences = await prisma.sessionOccurrence.findMany({
      where: {
        startsAt: { gte: start },
        endsAt: { lte: end }
      },
      include: {
        session: true,
        _count: { select: { registrations: true, subSignups: true } }
      },
      orderBy: { startsAt: 'asc' }
    })

    const attendingCountByOccurrenceId = new Map<string, number>()
    const activeSubCountByOccurrenceId = new Map<string, number>()
    const registeredUsersByOccurrenceId = new Map<string, SessionParticipantSummary[]>()
    const subUsersByOccurrenceId = new Map<string, SessionParticipantSummary[]>()
    if (occurrences.length > 0) {
      const occurrenceIds = occurrences.map((occurrence) => occurrence.id)
      const [attendingCounts, activeSubCounts, attendingRegistrations, nonCanceledSubSignups] = await Promise.all([
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
            status: subSignupStatusActive
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
            user: { select: { id: true, displayName: true } }
          },
          orderBy: { createdAt: 'asc' }
        }),
        prisma.subSignup.findMany({
          where: {
            occurrenceId: { in: occurrenceIds },
            status: { not: subSignupStatusCanceled }
          },
          select: {
            occurrenceId: true,
            user: { select: { id: true, displayName: true } }
          },
          orderBy: { createdAt: 'asc' }
        })
      ])

      attendingCounts.forEach((countEntry) => {
        attendingCountByOccurrenceId.set(countEntry.occurrenceId, countEntry._count._all)
      })
      logger.info(
        { occurrenceCount: occurrences.length, attendingRegistrationCounts: attendingCounts.length },
        logLoadedAttendingRegistrationCounts
      )

      activeSubCounts.forEach((countEntry) => {
        activeSubCountByOccurrenceId.set(countEntry.occurrenceId, countEntry._count._all)
      })
      logger.info(
        { occurrenceCount: occurrences.length, activeSubSignupCounts: activeSubCounts.length },
        logLoadedActiveSubSignupCounts
      )

      attendingRegistrations.forEach((registration) => {
        appendParticipantByOccurrence(
          registeredUsersByOccurrenceId,
          registration.occurrenceId,
          registration.user.id,
          registration.user.displayName
        )
      })
      nonCanceledSubSignups.forEach((subSignup) => {
        appendParticipantByOccurrence(
          subUsersByOccurrenceId,
          subSignup.occurrenceId,
          subSignup.user.id,
          subSignup.user.displayName
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
              status: subSignupStatusActive
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
            allowedStatuses: [subSignupStatusActive],
            filteredOutStatuses: [subSignupStatusCanceled, subSignupStatusSelected, subSignupStatusReplaced]
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

        const activeSubCount = activeSubCountByOccurrenceId.get(typedOccurrence.id) ?? 0
        return this.mapOccurrenceToSummary(
          typedOccurrence,
          registrationStatus,
          subSignupStatus,
          isUserAssignedToSession,
          attendingCount,
          activeSubCount,
          registeredUsers,
          subUsers,
          now
        )
      }

      const activeSubCount = activeSubCountByOccurrenceId.get(occurrence.id) ?? 0
      return this.mapOccurrenceToSummary(
        occurrence as OccurrenceWithSession,
        null,
        null,
        false,
        attendingCount,
        activeSubCount,
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

  public async createSession(
    title: string,
    weekday: Weekday,
    startTimeMinutes: number,
    endTimeMinutes: number,
    capacity?: number
  ) {
    const session = await prisma.session.create({
      data: {
        league: { connect: { id: await this.getDefaultLeagueId() } },
        title,
        weekday,
        startTimeMinutes,
        endTimeMinutes,
        capacity: capacity ?? sessionCapacityDefault
      }
    })

    logger.info({ sessionId: session.id, weekday }, 'Created session template')
    return session
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

    const [attendingCount, activeSubCount, attendingRegistrations, nonCanceledSubSignups] = await Promise.all([
      prisma.sessionRegistration.count({
        where: { occurrenceId, status: registrationStatusAttending }
      }),
      prisma.subSignup.count({
        where: { occurrenceId, status: subSignupStatusActive }
      }),
      prisma.sessionRegistration.findMany({
        where: { occurrenceId, status: registrationStatusAttending },
        select: { user: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.subSignup.findMany({
        where: { occurrenceId, status: { not: subSignupStatusCanceled } },
        select: { user: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'asc' }
      })
    ])
    const registeredUsers = attendingRegistrations.map((registration) => ({
      id: registration.user.id,
      displayName: registration.user.displayName?.trim() || null,
      profileImageUrl: null
    }))
    const subUsers = nonCanceledSubSignups.map((subSignup) => ({
      id: subSignup.user.id,
      displayName: subSignup.user.displayName?.trim() || null,
      profileImageUrl: null
    }))
    const isUserAssignedToSession = false
    logger.info({ occurrenceId, isUserAssignedToSession }, logSessionSummaryWithoutAssignment)
    return this.mapOccurrenceToSummary(
      occurrence,
      null,
      null,
      isUserAssignedToSession,
      attendingCount,
      activeSubCount,
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
          orderBy: { createdAt: 'asc' }
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
        role: registration.user.role
      },
      status: registration.status
    }))

    const subEntries: SessionRosterEntry[] = occurrence.subSignups.map((signup) => ({
      user: {
        id: signup.user.id,
        phoneNumber: signup.user.phoneNumber,
        displayName: signup.user.displayName,
        role: signup.user.role
      },
      status: signup.status,
      selectionRank: signup.selectionRank
    }))

    const capacity = occurrence.session.capacity ?? sessionCapacityDefault
    const openSpots = Math.max(capacity - occurrence.registrations.length, 0)

    let canRegister = false
    let canSub = false

    if (userId) {
      const assignment = await prisma.slotAssignment.findFirst({
        where: { userId, sessionId: occurrence.sessionId }
      })
      const isUserAssignedToSession = Boolean(assignment)
      const hasRegistration = await prisma.sessionRegistration.findFirst({
        where: { userId, occurrenceId, status: registrationStatusAttending }
      })
      const hasSubSignup = await prisma.subSignup.findFirst({
        where: { userId, occurrenceId, status: { in: [subSignupStatusActive, subSignupStatusSelected] } }
      })

      canRegister = Boolean(isUserAssignedToSession && !hasRegistration)
      canSub = Boolean(!isUserAssignedToSession && !hasSubSignup)
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

  private async getDefaultLeagueId(): Promise<string> {
    const league = await prisma.league.findFirst()

    if (!league) {
      const created = await prisma.league.create({
        data: { name: 'Default League' }
      })
      return created.id
    }

    return league.id
  }

  private mapOccurrenceToSummary(
    occurrence: OccurrenceWithSession,
    registrationStatus: RegistrationStatus | null,
    subSignupStatus: SubSignupStatus | null,
    isUserAssignedToSession: boolean,
    attendingCount: number,
    activeSubCount: number,
    registeredUsers: SessionParticipantSummary[],
    subUsers: SessionParticipantSummary[],
    now: Date
  ): SessionOccurrenceSummary {
    const liveOpensAt = calculateLiveOpensAt(occurrence.startsAt)
    const displayState = getSessionDisplayState(now, occurrence.endsAt, liveOpensAt)
    return {
      id: occurrence.id,
      sessionId: occurrence.sessionId,
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
      subCount: activeSubCount,
      registeredUsers,
      subUsers,
      displayState,
      liveOpensAt
    }
  }
}
