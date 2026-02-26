import type { RegistrationStatus, SubSignupStatus, Weekday } from '../../generated/prisma/client.js'
import type { SessionOccurrenceGetPayload } from '../../generated/prisma/models/SessionOccurrence.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { registrationCloseHour, registrationOpenHour, sessionCapacityDefault } from '../../shared/constants.js'

type SessionWindow = {
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

/**
 * SessionService
 * - Lists sessions with derived registration windows.
 * - Creates sessions tied to the default league.
 * - Used by session queries and admin mutations.
 */
export class SessionService {
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

  private calculateRegistrationWindow(startsAt: Date): SessionWindow {
    const openAt = new Date(startsAt)
    openAt.setDate(openAt.getDate() - 1)
    openAt.setHours(registrationOpenHour, 0, 0, 0)

    const closeAt = new Date(startsAt)
    closeAt.setDate(closeAt.getDate() - 1)
    closeAt.setHours(registrationCloseHour, 0, 0, 0)

    return { registrationOpenAt: openAt, registrationCloseAt: closeAt }
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
