import type {
  LeagueStatus,
  RegistrationStatus,
  Prisma,
  SessionOccurrenceStatus,
  SessionStatus,
  SubSignupStatus,
  UserRole,
  Weekday
} from '../../generated/prisma/client.js'
import { sessionCapacityDefault } from '../../shared/constants.js'
import { normalizePhoneNumber } from '../../shared/phone.js'
import { prisma } from '../../shared/prisma.js'
import { SessionService } from '../sessions/sessionService.js'

const leagueStatusDraft: LeagueStatus = 'DRAFT'
const leagueStatusActive: LeagueStatus = 'ACTIVE'
const leagueStatusArchived: LeagueStatus = 'ARCHIVED'
const sessionStatusActive: SessionStatus = 'ACTIVE'
const sessionStatusArchived: SessionStatus = 'ARCHIVED'
const occurrenceStatusCanceled: SessionOccurrenceStatus = 'CANCELED'
const playerRole: UserRole = 'PLAYER'
const registrationStatusAttending: RegistrationStatus = 'ATTENDING'
const subSignupStatusActive: SubSignupStatus = 'ACTIVE'
const subSignupStatusSelected: SubSignupStatus = 'SELECTED'
const deleteActionDeleted = 'DELETED'
const deleteActionArchived = 'ARCHIVED'
const deleteActionCanceled = 'CANCELED'
const sortOrderAscending = 'asc'
const sortOrderDescending = 'desc'
const minutesPerDay = 24 * 60
const paginationLimitDefault = 25
const paginationOffsetDefault = 0
const paginationLimitMax = 100
const errorLeagueMissing = 'League missing'
const errorSessionMissing = 'Session missing'
const errorOccurrenceMissing = 'Session occurrence missing'
const errorSlotAssignmentMissing = 'Slot assignment missing'
const errorPlayerMissing = 'Player missing'
const errorRuleMissing = 'League rule missing'
const errorSessionLeagueMismatch = 'Session does not belong to league'
const errorSessionArchived = 'Session is archived'
const errorStartBeforeEnd = 'startsAt must be before endsAt'
const errorDateRangeInvalid = 'startDate must be before endDate'
const errorOccurrenceBeforeLeagueStart =
  'startsAt must be on or after the parent league startDate'
const errorOccurrenceAfterLeagueEnd =
  'endsAt must be on or before the parent league endDate'
const errorTimeRangeInvalid = 'startTimeMinutes must be before endTimeMinutes'
const errorMinuteBounds = 'Session minutes must be within a 0-1439 range'
const errorSessionCapacityInvalid = 'Session capacity must be greater than zero'
const errorDuplicateAssignment =
  'User already has a slot assignment in this league'
const errorPaginationLimitInvalid =
  'pagination.limit must be an integer between 1 and 100'
const errorPaginationOffsetInvalid =
  'pagination.offset must be an integer greater than or equal to 0'

type TransactionClient = Prisma.TransactionClient

export type AdminDeleteOutcome = {
  id: string
  action: 'DELETED' | 'CANCELED' | 'ARCHIVED'
}

export type CreateLeagueInput = {
  name: string
  status?: LeagueStatus
  startDate?: Date | null
  endDate?: Date | null
  timeZone?: string | null
}

export type UpdateLeagueInput = {
  name?: string
  status?: LeagueStatus
  startDate?: Date | null
  endDate?: Date | null
  timeZone?: string | null
}

export type CreateSessionInput = {
  leagueId: string
  title: string
  weekday: Weekday
  startTimeMinutes: number
  endTimeMinutes: number
  capacity?: number | null
  status?: SessionStatus
}

export type UpdateSessionInput = {
  title?: string
  weekday?: Weekday
  startTimeMinutes?: number
  endTimeMinutes?: number
  capacity?: number | null
  status?: SessionStatus
}

export type CreateSessionOccurrenceInput = {
  sessionId: string
  startsAt: Date
  endsAt: Date
  status?: SessionOccurrenceStatus
}

export type UpdateSessionOccurrenceInput = {
  startsAt?: Date
  endsAt?: Date
  status?: SessionOccurrenceStatus
}

export type CreateSlotAssignmentInput = {
  leagueId: string
  sessionId: string
  phoneNumber: string
}

export type UpdateSlotAssignmentInput = {
  sessionId?: string
  phoneNumber?: string
}

export type PaginationInput = {
  limit?: number | null
  offset?: number | null
}

export type AdminLeaguesInput = {
  status?: LeagueStatus | null
  search?: string | null
  pagination?: PaginationInput | null
}

export type AdminPlayersInput = {
  search?: string | null
  role?: UserRole | null
  isOnApp?: boolean | null
  pagination?: PaginationInput | null
}

export type AdminCreatePlayerInput = {
  phoneNumber: string
  displayName?: string | null
  role?: UserRole | null
  isOnApp?: boolean | null
}

export type AdminUpdatePlayerInput = {
  phoneNumber?: string | null
  displayName?: string | null
  role?: UserRole | null
  isOnApp?: boolean | null
}

export type AdminOccurrenceRosterEntry = {
  user: {
    id: string
    phoneNumber: string
    displayName: string | null
    isOnApp: boolean
    role: UserRole
  }
  status: string
  selectionRank?: number | null
}

export type AdminOccurrenceRoster = {
  occurrenceId: string
  sessionId: string
  occurrenceStatus: SessionOccurrenceStatus
  startsAt: Date
  endsAt: Date
  openSpots: number
  attendees: AdminOccurrenceRosterEntry[]
  subs: AdminOccurrenceRosterEntry[]
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}

/**
 * AdminManagementService
 * - Encapsulates admin-only CRUD for leagues, session templates, occurrences, and slot assignments.
 * - Enforces league/session lifecycle constraints and delete semantics.
 * - Handles phone-based slot assignment with placeholder user creation.
 */
export class AdminManagementService {
  private resolvePagination(input: PaginationInput | null | undefined): {
    limit: number
    offset: number
  } {
    const limit = input?.limit ?? paginationLimitDefault
    const offset = input?.offset ?? paginationOffsetDefault

    const isLimitValid =
      Number.isInteger(limit) && limit >= 1 && limit <= paginationLimitMax
    if (!isLimitValid) {
      throw new Error(errorPaginationLimitInvalid)
    }

    const isOffsetValid =
      Number.isInteger(offset) && offset >= paginationOffsetDefault
    if (!isOffsetValid) {
      throw new Error(errorPaginationOffsetInvalid)
    }

    return { limit, offset }
  }

  private validateDateRange(
    startDate: Date | null | undefined,
    endDate: Date | null | undefined
  ): void {
    if (startDate && endDate && startDate >= endDate) {
      throw new Error(errorDateRangeInvalid)
    }
  }

  private validateSessionTimes(
    startTimeMinutes: number,
    endTimeMinutes: number
  ): void {
    const startsInRange =
      startTimeMinutes >= 0 && startTimeMinutes < minutesPerDay
    const endsInRange = endTimeMinutes >= 0 && endTimeMinutes < minutesPerDay
    if (!startsInRange || !endsInRange) {
      throw new Error(errorMinuteBounds)
    }

    if (startTimeMinutes >= endTimeMinutes) {
      throw new Error(errorTimeRangeInvalid)
    }
  }

  private assertOccurrenceWithinLeagueBounds(
    startsAt: Date,
    endsAt: Date,
    leagueStartDate: Date | null,
    leagueEndDate: Date | null
  ): void {
    if (leagueStartDate && startsAt < leagueStartDate) {
      throw new Error(errorOccurrenceBeforeLeagueStart)
    }

    if (leagueEndDate && endsAt > leagueEndDate) {
      throw new Error(errorOccurrenceAfterLeagueEnd)
    }
  }

  private async archiveOtherActiveLeagues(
    tx: TransactionClient,
    leagueId: string
  ): Promise<void> {
    await tx.league.updateMany({
      where: {
        id: { not: leagueId },
        status: leagueStatusActive
      },
      data: {
        status: leagueStatusArchived
      }
    })
  }

  public async createLeague(input: CreateLeagueInput) {
    this.validateDateRange(input.startDate, input.endDate)
    const leagueStatus = input.status ?? leagueStatusDraft

    return prisma.$transaction(async (tx) => {
      const createdLeague = await tx.league.create({
        data: {
          name: input.name,
          status: leagueStatus,
          startDate: input.startDate,
          endDate: input.endDate,
          timeZone: input.timeZone
        }
      })

      if (createdLeague.status === leagueStatusActive) {
        await this.archiveOtherActiveLeagues(tx, createdLeague.id)
      }

      return createdLeague
    })
  }

  public async updateLeague(leagueId: string, input: UpdateLeagueInput) {
    const existingLeague = await prisma.league.findUnique({
      where: { id: leagueId }
    })

    if (!existingLeague) {
      throw new Error(errorLeagueMissing)
    }

    const nextStartDate =
      input.startDate === undefined ? existingLeague.startDate : input.startDate
    const nextEndDate =
      input.endDate === undefined ? existingLeague.endDate : input.endDate
    this.validateDateRange(nextStartDate, nextEndDate)

    return prisma.$transaction(async (tx) => {
      const updatedLeague = await tx.league.update({
        where: { id: leagueId },
        data: {
          name: input.name,
          status: input.status,
          startDate: input.startDate,
          endDate: input.endDate,
          timeZone: input.timeZone
        }
      })

      if (updatedLeague.status === leagueStatusActive) {
        await this.archiveOtherActiveLeagues(tx, updatedLeague.id)
      }

      return updatedLeague
    })
  }

  public async adminLeagues(input: AdminLeaguesInput) {
    const { limit, offset } = this.resolvePagination(input.pagination)
    const trimmedSearch = input.search?.trim()
    const whereClause: Prisma.LeagueWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(trimmedSearch
        ? {
            name: {
              contains: trimmedSearch,
              mode: 'insensitive'
            }
          }
        : {})
    }

    const [totalCount, items] = await prisma.$transaction([
      prisma.league.count({ where: whereClause }),
      prisma.league.findMany({
        where: whereClause,
        orderBy: [{ createdAt: sortOrderDescending }],
        skip: offset,
        take: limit
      })
    ])

    return {
      items,
      totalCount,
      limit,
      offset
    }
  }

  public async adminLeagueDetail(leagueId: string) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId }
    })

    if (!league) {
      throw new Error(errorLeagueMissing)
    }

    return league
  }

  public async adminLeagueRules(leagueId: string) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true }
    })

    if (!league) {
      throw new Error(errorLeagueMissing)
    }

    return prisma.leagueRule.findMany({
      where: { leagueId },
      orderBy: { order: sortOrderAscending }
    })
  }

  public async adminPlayers(input: AdminPlayersInput) {
    const { limit, offset } = this.resolvePagination(input.pagination)
    const trimmedSearch = input.search?.trim()
    const searchClause = trimmedSearch
      ? {
          OR: [
            {
              phoneNumber: {
                contains: trimmedSearch,
                mode: 'insensitive' as const
              }
            },
            {
              displayName: {
                contains: trimmedSearch,
                mode: 'insensitive' as const
              }
            }
          ]
        }
      : {}

    const whereClause: Prisma.UserWhereInput = {
      ...(input.role ? { role: input.role } : {}),
      ...(input.isOnApp === undefined || input.isOnApp === null
        ? {}
        : { isOnApp: input.isOnApp }),
      ...searchClause
    }

    const [totalCount, items] = await prisma.$transaction([
      prisma.user.count({ where: whereClause }),
      prisma.user.findMany({
        where: whereClause,
        orderBy: [{ createdAt: sortOrderDescending }],
        skip: offset,
        take: limit
      })
    ])

    return {
      items,
      totalCount,
      limit,
      offset
    }
  }

  public async adminOccurrenceRoster(
    occurrenceId: string
  ): Promise<AdminOccurrenceRoster> {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        session: true,
        registrations: {
          include: { user: true },
          orderBy: { createdAt: sortOrderAscending }
        },
        subSignups: {
          include: { user: true },
          orderBy: { signedUpAt: sortOrderAscending }
        }
      }
    })

    if (!occurrence) {
      throw new Error(errorOccurrenceMissing)
    }

    const attendees = occurrence.registrations.map((registration) => ({
      user: {
        id: registration.user.id,
        phoneNumber: registration.user.phoneNumber,
        displayName: registration.user.displayName,
        isOnApp: registration.user.isOnApp,
        role: registration.user.role
      },
      status: registration.status
    }))

    const subs = occurrence.subSignups.map((subSignup) => ({
      user: {
        id: subSignup.user.id,
        phoneNumber: subSignup.user.phoneNumber,
        displayName: subSignup.user.displayName,
        isOnApp: subSignup.user.isOnApp,
        role: subSignup.user.role
      },
      status: subSignup.status,
      selectionRank: subSignup.selectionRank
    }))

    const attendeeCount = occurrence.registrations.filter(
      (registration) => registration.status === registrationStatusAttending
    ).length
    const openSpots = Math.max(
      (occurrence.session.capacity ?? sessionCapacityDefault) - attendeeCount,
      0
    )

    return {
      occurrenceId: occurrence.id,
      sessionId: occurrence.sessionId,
      occurrenceStatus: occurrence.status,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      openSpots,
      attendees,
      subs
    }
  }

  public async deleteLeague(leagueId: string): Promise<AdminDeleteOutcome> {
    return prisma.$transaction(async (tx) => {
      const league = await tx.league.findUnique({
        where: { id: leagueId },
        select: { id: true }
      })

      if (!league) {
        throw new Error(errorLeagueMissing)
      }

      const sessions = await tx.session.findMany({
        where: { leagueId },
        select: { id: true }
      })
      const sessionIds = sessions.map((session) => session.id)

      if (sessionIds.length > 0) {
        const occurrences = await tx.sessionOccurrence.findMany({
          where: {
            sessionId: { in: sessionIds }
          },
          select: { id: true }
        })
        const occurrenceIds = occurrences.map((occurrence) => occurrence.id)

        if (occurrenceIds.length > 0) {
          await tx.notification.deleteMany({
            where: {
              occurrenceId: { in: occurrenceIds }
            }
          })
          await tx.subSignup.deleteMany({
            where: {
              occurrenceId: { in: occurrenceIds }
            }
          })
          await tx.sessionRegistration.deleteMany({
            where: {
              occurrenceId: { in: occurrenceIds }
            }
          })
          await tx.sessionOccurrence.deleteMany({
            where: {
              id: { in: occurrenceIds }
            }
          })
        }
      }

      await tx.slotAssignment.deleteMany({
        where: { leagueId }
      })
      await tx.session.deleteMany({
        where: { leagueId }
      })
      await tx.leagueRule.deleteMany({
        where: { leagueId }
      })
      await tx.league.delete({
        where: { id: leagueId }
      })

      return {
        id: leagueId,
        action: deleteActionDeleted
      }
    })
  }

  public async createSession(input: CreateSessionInput) {
    this.validateSessionTimes(input.startTimeMinutes, input.endTimeMinutes)
    const capacity = input.capacity ?? sessionCapacityDefault
    if (capacity <= 0) {
      throw new Error(errorSessionCapacityInvalid)
    }

    const league = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { id: true, status: true }
    })

    if (!league) {
      throw new Error(errorLeagueMissing)
    }

    if (league.status === leagueStatusArchived) {
      throw new Error('League is archived')
    }

    return prisma.session.create({
      data: {
        leagueId: input.leagueId,
        title: input.title,
        weekday: input.weekday,
        startTimeMinutes: input.startTimeMinutes,
        endTimeMinutes: input.endTimeMinutes,
        capacity,
        status: input.status ?? sessionStatusActive
      }
    })
  }

  public async updateSession(sessionId: string, input: UpdateSessionInput) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        startTimeMinutes: true,
        endTimeMinutes: true
      }
    })

    if (!session) {
      throw new Error(errorSessionMissing)
    }

    const nextStartTimeMinutes =
      input.startTimeMinutes ?? session.startTimeMinutes
    const nextEndTimeMinutes = input.endTimeMinutes ?? session.endTimeMinutes
    this.validateSessionTimes(nextStartTimeMinutes, nextEndTimeMinutes)

    if (
      input.capacity !== undefined &&
      input.capacity !== null &&
      input.capacity <= 0
    ) {
      throw new Error(errorSessionCapacityInvalid)
    }

    return prisma.$transaction(async (tx) => {
      const updatedSession = await tx.session.update({
        where: { id: sessionId },
        data: {
          title: input.title,
          weekday: input.weekday,
          startTimeMinutes: input.startTimeMinutes,
          endTimeMinutes: input.endTimeMinutes,
          capacity: input.capacity ?? undefined,
          status: input.status
        }
      })

      if (updatedSession.status === sessionStatusArchived) {
        await tx.sessionOccurrence.updateMany({
          where: {
            sessionId: updatedSession.id,
            status: { not: occurrenceStatusCanceled }
          },
          data: {
            status: occurrenceStatusCanceled
          }
        })
      }

      return updatedSession
    })
  }

  public async deleteSession(sessionId: string): Promise<AdminDeleteOutcome> {
    return prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: { id: true }
      })
      if (!session) {
        throw new Error(errorSessionMissing)
      }

      const hasHistory = await tx.sessionOccurrence.findFirst({
        where: {
          sessionId,
          OR: [{ registrations: { some: {} } }, { subSignups: { some: {} } }]
        },
        select: { id: true }
      })

      if (hasHistory) {
        await tx.sessionOccurrence.updateMany({
          where: {
            sessionId,
            status: { not: occurrenceStatusCanceled }
          },
          data: {
            status: occurrenceStatusCanceled
          }
        })

        await tx.session.update({
          where: { id: sessionId },
          data: { status: sessionStatusArchived }
        })

        return {
          id: sessionId,
          action: deleteActionArchived
        }
      }

      const occurrences = await tx.sessionOccurrence.findMany({
        where: { sessionId },
        select: { id: true }
      })
      const occurrenceIds = occurrences.map((occurrence) => occurrence.id)

      if (occurrenceIds.length > 0) {
        await tx.notification.deleteMany({
          where: {
            occurrenceId: { in: occurrenceIds }
          }
        })
        await tx.subSignup.deleteMany({
          where: {
            occurrenceId: { in: occurrenceIds }
          }
        })
        await tx.sessionRegistration.deleteMany({
          where: {
            occurrenceId: { in: occurrenceIds }
          }
        })
        await tx.sessionOccurrence.deleteMany({
          where: {
            id: { in: occurrenceIds }
          }
        })
      }

      await tx.slotAssignment.deleteMany({
        where: { sessionId }
      })
      await tx.session.delete({
        where: { id: sessionId }
      })

      return {
        id: sessionId,
        action: deleteActionDeleted
      }
    })
  }

  private async createOccurrenceInTransaction(
    tx: TransactionClient,
    input: CreateSessionOccurrenceInput
  ) {
    if (input.startsAt >= input.endsAt) {
      throw new Error(errorStartBeforeEnd)
    }

    const session = await tx.session.findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        status: true,
        league: {
          select: {
            startDate: true,
            endDate: true
          }
        }
      }
    })

    if (!session) {
      throw new Error(errorSessionMissing)
    }

    if (session.status === sessionStatusArchived) {
      throw new Error(errorSessionArchived)
    }

    this.assertOccurrenceWithinLeagueBounds(
      input.startsAt,
      input.endsAt,
      session.league.startDate,
      session.league.endDate
    )

    return tx.sessionOccurrence.create({
      data: {
        sessionId: input.sessionId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: input.status
      }
    })
  }

  public async createSessionOccurrence(input: CreateSessionOccurrenceInput) {
    return prisma.$transaction(async (tx) =>
      this.createOccurrenceInTransaction(tx, input)
    )
  }

  public async createSessionOccurrences(
    inputs: CreateSessionOccurrenceInput[]
  ) {
    return prisma.$transaction(async (tx) => {
      const createdOccurrences = []

      for (const [index, input] of inputs.entries()) {
        try {
          const created = await this.createOccurrenceInTransaction(tx, input)
          createdOccurrences.push(created)
        } catch (error) {
          throw new Error(
            `Occurrence at index ${String(index)}: ${getErrorMessage(error)}`
          )
        }
      }

      return createdOccurrences
    })
  }

  public async updateSessionOccurrence(
    occurrenceId: string,
    input: UpdateSessionOccurrenceInput
  ) {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        session: {
          select: {
            league: {
              select: {
                startDate: true,
                endDate: true
              }
            }
          }
        }
      }
    })
    if (!occurrence) {
      throw new Error(errorOccurrenceMissing)
    }

    const nextStartsAt = input.startsAt ?? occurrence.startsAt
    const nextEndsAt = input.endsAt ?? occurrence.endsAt
    if (nextStartsAt >= nextEndsAt) {
      throw new Error(errorStartBeforeEnd)
    }
    this.assertOccurrenceWithinLeagueBounds(
      nextStartsAt,
      nextEndsAt,
      occurrence.session.league.startDate,
      occurrence.session.league.endDate
    )

    const updatedOccurrence = await prisma.sessionOccurrence.update({
      where: { id: occurrenceId },
      data: {
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: input.status
      }
    })

    if (input.status === occurrenceStatusCanceled) {
      const sessionService = new SessionService()
      await sessionService.cancelSessionOccurrence(occurrenceId)
    }

    return updatedOccurrence
  }

  public async deleteSessionOccurrence(
    occurrenceId: string
  ): Promise<AdminDeleteOutcome> {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      select: {
        id: true,
        _count: {
          select: {
            registrations: true,
            subSignups: true
          }
        }
      }
    })

    if (!occurrence) {
      throw new Error(errorOccurrenceMissing)
    }

    const hasHistory =
      occurrence._count.registrations > 0 || occurrence._count.subSignups > 0
    if (hasHistory) {
      const sessionService = new SessionService()
      await sessionService.cancelSessionOccurrence(occurrenceId)
      return {
        id: occurrenceId,
        action: deleteActionCanceled
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({
        where: { occurrenceId }
      })
      await tx.subSignup.deleteMany({
        where: { occurrenceId }
      })
      await tx.sessionRegistration.deleteMany({
        where: { occurrenceId }
      })
      await tx.sessionOccurrence.delete({
        where: { id: occurrenceId }
      })
    })

    return {
      id: occurrenceId,
      action: deleteActionDeleted
    }
  }

  private async upsertUserFromPhoneNumber(
    tx: TransactionClient,
    phoneNumber: string
  ): Promise<string> {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber)
    const user = await tx.user.upsert({
      where: { phoneNumber: normalizedPhoneNumber },
      create: {
        phoneNumber: normalizedPhoneNumber,
        role: playerRole
      },
      update: {}
    })

    return user.id
  }

  private async getSessionForAssignmentValidation(
    tx: TransactionClient,
    leagueId: string,
    sessionId: string
  ): Promise<void> {
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      select: {
        leagueId: true,
        status: true
      }
    })

    if (!session) {
      throw new Error(errorSessionMissing)
    }

    if (session.leagueId !== leagueId) {
      throw new Error(errorSessionLeagueMismatch)
    }

    if (session.status === sessionStatusArchived) {
      throw new Error(errorSessionArchived)
    }
  }

  private async mapSlotAssignment(assignmentId: string) {
    const assignment = await prisma.slotAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        user: {
          select: {
            id: true,
            phoneNumber: true,
            isOnApp: true
          }
        }
      }
    })

    if (!assignment) {
      throw new Error(errorSlotAssignmentMissing)
    }

    return assignment
  }

  public async createSlotAssignment(input: CreateSlotAssignmentInput) {
    const assignmentId = await prisma.$transaction(async (tx) => {
      await this.getSessionForAssignmentValidation(
        tx,
        input.leagueId,
        input.sessionId
      )
      const userId = await this.upsertUserFromPhoneNumber(tx, input.phoneNumber)
      const assignment = await tx.slotAssignment.upsert({
        where: {
          leagueId_userId: {
            leagueId: input.leagueId,
            userId
          }
        },
        create: {
          leagueId: input.leagueId,
          sessionId: input.sessionId,
          userId
        },
        update: {
          sessionId: input.sessionId
        }
      })

      return assignment.id
    })

    return this.mapSlotAssignment(assignmentId)
  }

  public async createSlotAssignments(inputs: CreateSlotAssignmentInput[]) {
    const assignmentIds = await prisma.$transaction(async (tx) => {
      const ids = []

      for (const [index, input] of inputs.entries()) {
        try {
          await this.getSessionForAssignmentValidation(
            tx,
            input.leagueId,
            input.sessionId
          )
          const userId = await this.upsertUserFromPhoneNumber(
            tx,
            input.phoneNumber
          )
          const assignment = await tx.slotAssignment.upsert({
            where: {
              leagueId_userId: {
                leagueId: input.leagueId,
                userId
              }
            },
            create: {
              leagueId: input.leagueId,
              sessionId: input.sessionId,
              userId
            },
            update: {
              sessionId: input.sessionId
            }
          })
          ids.push(assignment.id)
        } catch (error) {
          throw new Error(
            `Slot assignment at index ${String(index)}: ${getErrorMessage(error)}`
          )
        }
      }

      return ids
    })

    return Promise.all(
      assignmentIds.map((assignmentId) => this.mapSlotAssignment(assignmentId))
    )
  }

  public async updateSlotAssignment(
    slotAssignmentId: string,
    input: UpdateSlotAssignmentInput
  ) {
    const assignment = await prisma.slotAssignment.findUnique({
      where: { id: slotAssignmentId },
      select: {
        id: true,
        leagueId: true,
        sessionId: true,
        userId: true
      }
    })
    if (!assignment) {
      throw new Error(errorSlotAssignmentMissing)
    }

    const updatedAssignmentId = await prisma.$transaction(async (tx) => {
      let nextSessionId = assignment.sessionId
      if (input.sessionId) {
        await this.getSessionForAssignmentValidation(
          tx,
          assignment.leagueId,
          input.sessionId
        )
        nextSessionId = input.sessionId
      }

      let nextUserId = assignment.userId
      if (input.phoneNumber) {
        nextUserId = await this.upsertUserFromPhoneNumber(tx, input.phoneNumber)
      }

      if (nextUserId !== assignment.userId) {
        const conflictingAssignment = await tx.slotAssignment.findUnique({
          where: {
            leagueId_userId: {
              leagueId: assignment.leagueId,
              userId: nextUserId
            }
          },
          select: { id: true }
        })

        if (
          conflictingAssignment &&
          conflictingAssignment.id !== assignment.id
        ) {
          throw new Error(errorDuplicateAssignment)
        }
      }

      const updated = await tx.slotAssignment.update({
        where: { id: slotAssignmentId },
        data: {
          sessionId: nextSessionId,
          userId: nextUserId
        }
      })

      return updated.id
    })

    return this.mapSlotAssignment(updatedAssignmentId)
  }

  public async adminCreatePlayer(input: AdminCreatePlayerInput) {
    const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber)
    return prisma.user.create({
      data: {
        phoneNumber: normalizedPhoneNumber,
        displayName: input.displayName ?? null,
        role: input.role ?? playerRole,
        isOnApp: input.isOnApp ?? false
      }
    })
  }

  public async adminUpdatePlayer(
    playerId: string,
    input: AdminUpdatePlayerInput
  ) {
    const existingUser = await prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true }
    })

    if (!existingUser) {
      throw new Error(errorPlayerMissing)
    }

    const normalizedPhoneNumber = input.phoneNumber
      ? normalizePhoneNumber(input.phoneNumber)
      : undefined
    const nextDisplayName =
      input.displayName === undefined ? undefined : input.displayName
    return prisma.user.update({
      where: { id: playerId },
      data: {
        phoneNumber: normalizedPhoneNumber,
        displayName: nextDisplayName,
        role: input.role ?? undefined,
        isOnApp: input.isOnApp ?? undefined
      }
    })
  }

  public async adminUpsertLeagueRule(
    leagueId: string,
    ruleId: string | null | undefined,
    title: string,
    body: string,
    order: number
  ) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true }
    })

    if (!league) {
      throw new Error(errorLeagueMissing)
    }

    if (ruleId) {
      const existingRule = await prisma.leagueRule.findUnique({
        where: { id: ruleId },
        select: { id: true, leagueId: true }
      })
      if (!existingRule || existingRule.leagueId !== leagueId) {
        throw new Error(errorRuleMissing)
      }

      return prisma.leagueRule.update({
        where: { id: ruleId },
        data: {
          title,
          body,
          order
        }
      })
    }

    return prisma.leagueRule.upsert({
      where: {
        leagueId_order: {
          leagueId,
          order
        }
      },
      create: {
        leagueId,
        title,
        body,
        order
      },
      update: {
        title,
        body
      }
    })
  }

  public async adminCopyLeagueRulesFromTemplate(
    sourceLeagueId: string,
    targetLeagueId: string,
    replaceExisting: boolean
  ) {
    const [sourceLeague, targetLeague] = await prisma.$transaction([
      prisma.league.findUnique({
        where: { id: sourceLeagueId },
        select: { id: true }
      }),
      prisma.league.findUnique({
        where: { id: targetLeagueId },
        select: { id: true }
      })
    ])

    if (!sourceLeague || !targetLeague) {
      throw new Error(errorLeagueMissing)
    }

    const sourceRules = await prisma.leagueRule.findMany({
      where: { leagueId: sourceLeagueId },
      orderBy: { order: sortOrderAscending }
    })

    return prisma.$transaction(async (tx) => {
      if (replaceExisting) {
        await tx.leagueRule.deleteMany({
          where: { leagueId: targetLeagueId }
        })
      }

      for (const sourceRule of sourceRules) {
        await tx.leagueRule.upsert({
          where: {
            leagueId_order: {
              leagueId: targetLeagueId,
              order: sourceRule.order
            }
          },
          create: {
            leagueId: targetLeagueId,
            title: sourceRule.title,
            body: sourceRule.body,
            order: sourceRule.order
          },
          update: {
            title: sourceRule.title,
            body: sourceRule.body
          }
        })
      }

      return tx.leagueRule.findMany({
        where: { leagueId: targetLeagueId },
        orderBy: { order: sortOrderAscending }
      })
    })
  }

  public async adminSetRegistration(
    occurrenceId: string,
    userId: string,
    status: RegistrationStatus
  ) {
    const [occurrence, user] = await prisma.$transaction([
      prisma.sessionOccurrence.findUnique({
        where: { id: occurrenceId },
        select: { id: true, status: true }
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    ])

    if (!occurrence) {
      throw new Error(errorOccurrenceMissing)
    }

    if (!user) {
      throw new Error(errorPlayerMissing)
    }

    return prisma.sessionRegistration.upsert({
      where: {
        userId_occurrenceId: {
          userId,
          occurrenceId
        }
      },
      create: {
        userId,
        occurrenceId,
        status
      },
      update: {
        status
      }
    })
  }

  public async adminSetSubSignup(
    occurrenceId: string,
    userId: string,
    status: SubSignupStatus
  ) {
    const [occurrence, user, existingSubSignup] = await prisma.$transaction([
      prisma.sessionOccurrence.findUnique({
        where: { id: occurrenceId },
        select: { id: true, status: true }
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.subSignup.findUnique({
        where: {
          userId_occurrenceId: {
            userId,
            occurrenceId
          }
        }
      })
    ])

    if (!occurrence) {
      throw new Error(errorOccurrenceMissing)
    }

    if (!user) {
      throw new Error(errorPlayerMissing)
    }

    if (!existingSubSignup) {
      return prisma.subSignup.create({
        data: {
          userId,
          occurrenceId,
          status,
          signedUpAt: new Date(),
          selectedAt: status === subSignupStatusSelected ? new Date() : null
        }
      })
    }

    const nextSelectionValues =
      status === subSignupStatusActive
        ? {
            signedUpAt: new Date(),
            selectionRank: null,
            selectedAt: null
          }
        : status === subSignupStatusSelected
          ? {
              selectedAt: existingSubSignup.selectedAt ?? new Date()
            }
          : {}

    return prisma.subSignup.update({
      where: {
        userId_occurrenceId: {
          userId,
          occurrenceId
        }
      },
      data: {
        status,
        ...nextSelectionValues
      }
    })
  }

  public async deleteSlotAssignment(
    slotAssignmentId: string
  ): Promise<AdminDeleteOutcome> {
    await prisma.slotAssignment.delete({
      where: { id: slotAssignmentId }
    })

    return {
      id: slotAssignmentId,
      action: deleteActionDeleted
    }
  }
}
