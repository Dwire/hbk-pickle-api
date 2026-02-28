import type { RegistrationStatus, SubSignupStatus, Weekday } from '../../generated/prisma/client.js'
import type { SessionOccurrenceGetPayload } from '../../generated/prisma/models/SessionOccurrence.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { registrationCloseHour, registrationOpenHour, sessionCapacityDefault } from '../../shared/constants.js'

const easternTimeZone = 'America/New_York'
const localeEnUs = 'en-US'
const weekdayFormatStyle = 'short'
const hourCycle24 = 'h23'
const literalPartType = 'literal'
const yearPartType = 'year'
const monthPartType = 'month'
const dayPartType = 'day'
const hourPartType = 'hour'
const minutePartType = 'minute'
const secondPartType = 'second'
const weekdayLabelSun = 'Sun'
const weekdayLabelMon = 'Mon'
const weekdayLabelTue = 'Tue'
const weekdayLabelWed = 'Wed'
const weekdayLabelThu = 'Thu'
const weekdayLabelFri = 'Fri'
const weekdayLabelSat = 'Sat'
const sundayIndex = 0
const mondayIndex = 1
const daysPerWeek = 7
const millisecondsPerMinute = 60_000
const weekStartHour = 0
const weekStartMinute = 0
const weekStartSecond = 0
const weekStartMillisecond = 0
const weekEndHour = 23
const weekEndMinute = 59
const weekEndSecond = 59
const weekEndMillisecond = 999
const weekdayIndexByLabel: Record<string, number> = {
  [weekdayLabelSun]: sundayIndex,
  [weekdayLabelMon]: mondayIndex,
  [weekdayLabelTue]: 2,
  [weekdayLabelWed]: 3,
  [weekdayLabelThu]: 4,
  [weekdayLabelFri]: 5,
  [weekdayLabelSat]: 6
}

const easternDateTimeFormat = new Intl.DateTimeFormat(localeEnUs, {
  timeZone: easternTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: hourCycle24
})

const easternWeekdayFormat = new Intl.DateTimeFormat(localeEnUs, {
  timeZone: easternTimeZone,
  weekday: weekdayFormatStyle
})

export type SessionWindow = {
  registrationOpenAt: Date
  registrationCloseAt: Date
}

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
  attendingCount: number
  subCount: number
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
}

type OccurrenceWithSession = SessionOccurrenceGetPayload<{
  include: {
    session: true
    _count: { select: { registrations: true; subSignups: true } }
  }
}>

type OccurrenceWithUserData = SessionOccurrenceGetPayload<{
  include: {
    session: true
    _count: { select: { registrations: true; subSignups: true } }
    registrations: { select: { status: true } }
    subSignups: { select: { status: true } }
  }
}>

type DateParts = {
  year: number
  month: number
  day: number
}

type DateTimeParts = DateParts & {
  hour: number
  minute: number
  second: number
}

type LocalDateTime = DateTimeParts & {
  millisecond: number
}

const getEasternDateTimeParts = (date: Date): DateTimeParts => {
  const parts = easternDateTimeFormat.formatToParts(date)
  const lookup = new Map<string, string>()

  for (const part of parts) {
      if (part.type === literalPartType) {
        continue
      }

      lookup.set(part.type, part.value)
  }

  const yearValue = Number(lookup.get(yearPartType))
  const monthValue = Number(lookup.get(monthPartType))
  const dayValue = Number(lookup.get(dayPartType))
  const hourValue = Number(lookup.get(hourPartType))
  const minuteValue = Number(lookup.get(minutePartType))
  const secondValue = Number(lookup.get(secondPartType))

  return {
    year: yearValue,
    month: monthValue,
    day: dayValue,
    hour: hourValue,
    minute: minuteValue,
    second: secondValue
  }
}

const getEasternWeekdayIndex = (date: Date): number => {
  const label = easternWeekdayFormat.format(date)
  return weekdayIndexByLabel[label] ?? sundayIndex
}

const shiftDateByDays = (dateParts: DateParts, offsetDays: number): DateParts => {
  const shifted = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + offsetDays))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  }
}

const getEasternOffsetMinutes = (date: Date): number => {
  const parts = easternDateTimeFormat.formatToParts(date)
  const lookup = new Map<string, string>()

  for (const part of parts) {
      if (part.type === literalPartType) {
        continue
      }

      lookup.set(part.type, part.value)
  }

  const yearValue = Number(lookup.get(yearPartType))
  const monthValue = Number(lookup.get(monthPartType))
  const dayValue = Number(lookup.get(dayPartType))
  const hourValue = Number(lookup.get(hourPartType))
  const minuteValue = Number(lookup.get(minutePartType))
  const secondValue = Number(lookup.get(secondPartType))

  const utcTimestamp = Date.UTC(
    yearValue,
    monthValue - 1,
    dayValue,
    hourValue,
    minuteValue,
    secondValue
  )

  return (utcTimestamp - date.getTime()) / millisecondsPerMinute
}

const easternZonedTimeToUtc = (local: LocalDateTime): Date => {
  const utcGuess = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond)
  )
  const offsetMinutes = getEasternOffsetMinutes(utcGuess)
  return new Date(utcGuess.getTime() - offsetMinutes * millisecondsPerMinute)
}

export const getEasternDateParts = (date: Date): DateParts => {
  const parts = getEasternDateTimeParts(date)
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day
  }
}

export const getEasternDayRangeUtc = (date: Date): { start: Date; end: Date } => {
  const dateParts = getEasternDateParts(date)
  const start = easternZonedTimeToUtc({
    ...dateParts,
    hour: weekStartHour,
    minute: weekStartMinute,
    second: weekStartSecond,
    millisecond: weekStartMillisecond
  })
  const end = easternZonedTimeToUtc({
    ...dateParts,
    hour: weekEndHour,
    minute: weekEndMinute,
    second: weekEndSecond,
    millisecond: weekEndMillisecond
  })

  return { start, end }
}

const getEasternWeekRange = (now: Date): { start: Date; end: Date } => {
  const nowParts = getEasternDateTimeParts(now)
  const nowDateParts: DateParts = { year: nowParts.year, month: nowParts.month, day: nowParts.day }
  const weekdayIndex = getEasternWeekdayIndex(now)
  const daysSinceWeekStart = (weekdayIndex - mondayIndex + daysPerWeek) % daysPerWeek
  const startDateParts = shiftDateByDays(nowDateParts, -daysSinceWeekStart)
  const endDateParts = shiftDateByDays(startDateParts, daysPerWeek - 1)

  const start = easternZonedTimeToUtc({
    ...startDateParts,
    hour: weekStartHour,
    minute: weekStartMinute,
    second: weekStartSecond,
    millisecond: weekStartMillisecond
  })
  const end = easternZonedTimeToUtc({
    ...endDateParts,
    hour: weekEndHour,
    minute: weekEndMinute,
    second: weekEndSecond,
    millisecond: weekEndMillisecond
  })

  return { start, end }
}

/**
 * SessionService
 * - Lists sessions with derived registration windows.
 * - Creates sessions tied to the default league.
 * - Used by session queries and admin mutations.
 */
export class SessionService {
  public calculateRegistrationWindow(startsAt: Date): SessionWindow {
    const openAt = new Date(startsAt)
    openAt.setDate(openAt.getDate() - 1)
    openAt.setHours(registrationOpenHour, 0, 0, 0)

    const closeAt = new Date(startsAt)
    closeAt.setDate(closeAt.getDate() - 1)
    closeAt.setHours(registrationCloseHour, 0, 0, 0)

    return { registrationOpenAt: openAt, registrationCloseAt: closeAt }
  }

  public isWithinRegistrationWindow(now: Date, startsAt: Date): boolean {
    const { registrationOpenAt, registrationCloseAt } = this.calculateRegistrationWindow(startsAt)
    return now >= registrationOpenAt && now <= registrationCloseAt
  }
  /**
   * Lists session occurrences for the current Eastern week.
   * - Computes Monday 00:00 through Sunday 23:59:59.999 (Eastern).
   * - Delegates to range-based listing for the resulting UTC window.
   * - Used by the sessionsWeek query.
   */
  public async listSessionsWeek(userId?: string | null): Promise<SessionOccurrenceSummary[]> {
    const { start, end } = getEasternWeekRange(new Date())
    logger.info({ start, end, timeZone: easternTimeZone }, 'Listing sessions for eastern week')
    return this.listSessions(start, end, userId)
  }

  public async listSessions(start: Date, end: Date, userId?: string | null): Promise<SessionOccurrenceSummary[]> {
    const includeUserStatus = typeof userId === 'string' && userId.length > 0
    const occurrences = await prisma.sessionOccurrence.findMany({
      where: {
        startsAt: { gte: start },
        endsAt: { lte: end }
      },
      include: {
        session: true,
        _count: { select: { registrations: true, subSignups: true } },
        ...(includeUserStatus
          ? {
              registrations: { where: { userId }, select: { status: true }, take: 1 },
              subSignups: { where: { userId }, select: { status: true }, take: 1 }
            }
          : {})
      },
      orderBy: { startsAt: 'asc' }
    })

    return occurrences.map((occurrence: (typeof occurrences)[number]) => {
      if (includeUserStatus) {
        const typedOccurrence = occurrence as OccurrenceWithUserData
        const registrationStatus = typedOccurrence.registrations[0]?.status ?? null
        const subSignupStatus = typedOccurrence.subSignups[0]?.status ?? null

        return this.mapOccurrenceToSummary(typedOccurrence, registrationStatus, subSignupStatus)
      }

      return this.mapOccurrenceToSummary(occurrence as OccurrenceWithSession, null, null)
    })
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

    return this.mapOccurrenceToSummary(occurrence, null, null)
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
          where: { status: 'ATTENDING' },
          include: { user: true },
          orderBy: { createdAt: 'asc' }
        },
        subSignups: {
          where: { status: { in: ['ACTIVE', 'SELECTED', 'REPLACED'] } },
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
      const hasRegistration = await prisma.sessionRegistration.findFirst({
        where: { userId, occurrenceId, status: 'ATTENDING' }
      })
      const hasSubSignup = await prisma.subSignup.findFirst({
        where: { userId, occurrenceId, status: { in: ['ACTIVE', 'SELECTED'] } }
      })

      canRegister = Boolean(assignment && !hasRegistration)
      canSub = Boolean(!assignment && !hasSubSignup)
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
      isRegistrationOpen
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
    subSignupStatus: SubSignupStatus | null
  ): SessionOccurrenceSummary {
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
      attendingCount: occurrence._count.registrations,
      subCount: occurrence._count.subSignups
    }
  }
}
