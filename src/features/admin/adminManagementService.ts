import { Prisma as PrismaClient } from '../../generated/prisma/client.js'
import type {
  LeagueMembershipStatus,
  LeagueStatus,
  RegistrationStatus,
  Prisma,
  SessionOccurrenceStatus,
  SessionStatus,
  SubSignupStatus,
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
const leagueMembershipStatusActive: LeagueMembershipStatus = 'ACTIVE'
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
const adminLeagueDetailMaxOccurrencesDefault = 250
const errorOrganizationMissing = 'Organization missing'
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
const errorAdminLeagueDetailMaxOccurrencesInvalid =
  'maxOccurrencesPerSession must be an integer greater than or equal to 1'
const errorAdminLeagueDetailOccurrenceRangeInvalid =
  'occurrenceStart must be before or equal to occurrenceEnd'
const errorActiveLeagueMembershipRequired = 'User not active in this league'
const errorPlayerNotInOrganization = 'Player not in organization'
const errorPlayerNotInOccurrenceRoster = 'Player not in occurrence roster'
const errorOwnerRoleChangeNotAllowed =
  'Cannot change role for an organization owner with this mutation'
const errorOwnerRoleAssignmentNotAllowed =
  'Cannot assign OWNER role with this mutation'
const organizationMembershipRoleOwner = 'OWNER'
const organizationMembershipRoleAdmin = 'ADMIN'
const userRolePlayer = 'PLAYER'
const userRoleAdmin = 'ADMIN'
const userRoleOwner = 'OWNER'

const subSignupSummaryStatuses: SubSignupStatus[] = [
  subSignupStatusActive,
  subSignupStatusSelected
]

type TransactionClient = Prisma.TransactionClient

export type AdminDeleteOutcome = {
  id: string
  action: 'DELETED' | 'CANCELED' | 'ARCHIVED'
}

export type CreateLeagueInput = {
  organizationId: string
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
  organizationId: string
  status?: LeagueStatus | null
  search?: string | null
  pagination?: PaginationInput | null
}

export type AdminPlayersInput = {
  organizationId: string
  search?: string | null
  isOnApp?: boolean | null
  pagination?: PaginationInput | null
}

export type AdminCreatePlayerInput = {
  leagueId: string
  phoneNumber: string
  displayName?: string | null
}

export type AdminUpdatePlayerInput = {
  organizationId: string
  phoneNumber?: string | null
  displayName?: string | null
  role?: AdminUserRole | null
}

export type AdminUserRole = 'PLAYER' | 'ADMIN' | 'OWNER'

export type AdminSetLeagueMembershipInput = {
  leagueId: string
  userId: string
  status: LeagueMembershipStatus
}

export type AdminSetAttendanceConfirmationInput = {
  userId: string
  isConfirmed: boolean
}

export type AdminAttendanceConfirmation = {
  userId: string
  isConfirmed: boolean
  confirmedAt: Date | null
  confirmedByUserId: string | null
}

export type AdminOccurrenceRosterEntry = {
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

export type AdminOccurrenceRoster = {
  occurrenceId: string
  sessionId: string
  occurrenceStatus: SessionOccurrenceStatus
  startsAt: Date
  endsAt: Date
  openSpots: number
  confirmedCount: number
  unconfirmedCount: number
  attendanceConfirmations: AdminAttendanceConfirmation[]
  attendees: AdminOccurrenceRosterEntry[]
  subs: AdminOccurrenceRosterEntry[]
}

export type AdminLeagueMembership = {
  id: string
  leagueId: string
  userId: string
  status: LeagueMembershipStatus
  createdAt: Date
  updatedAt: Date
}

export type AdminLeagueDetailInput = {
  includeArchivedSessions?: boolean | null
  includeCanceledOccurrences?: boolean | null
  occurrenceStart?: Date | null
  occurrenceEnd?: Date | null
  maxOccurrencesPerSession?: number | null
}

type NormalizedAdminLeagueDetailInput = {
  includeArchivedSessions: boolean
  includeCanceledOccurrences: boolean
  occurrenceStart: Date | null
  occurrenceEnd: Date | null
  maxOccurrencesPerSession: number
}

type AdminSlotAssignmentWithUser = {
  id: string
  leagueId: string
  sessionId: string
  userId: string
  createdAt: Date
  user: {
    id: string
    phoneNumber: string
    displayName: string | null
    isOnApp: boolean
  }
}

export type AdminLeagueDetailOccurrence = {
  id: string
  sessionId: string
  startsAt: Date
  endsAt: Date
  status: SessionOccurrenceStatus
  createdAt: Date
  updatedAt: Date
  attendingCount: number
  subCount: number
  openSpots: number
}

export type AdminLeagueDetailSession = {
  id: string
  leagueId: string
  title: string
  weekday: Weekday
  startTimeMinutes: number
  endTimeMinutes: number
  capacity: number
  status: SessionStatus
  createdAt: Date
  updatedAt: Date
  assignmentCount: number
  occurrenceCount: number
  assignments: AdminSlotAssignmentWithUser[]
  occurrences: AdminLeagueDetailOccurrence[]
  adminLeagueDetailInputKey: string
}

type RankedOccurrenceRow = {
  id: string
  sessionId: string
  startsAt: Date
  endsAt: Date
  status: SessionOccurrenceStatus
  createdAt: Date
  updatedAt: Date
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
 * - Provides admin attendance confirmation writes/reads for occurrence rosters.
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

  private normalizeAdminLeagueDetailInput(
    input: AdminLeagueDetailInput | null | undefined
  ): NormalizedAdminLeagueDetailInput {
    const maxOccurrencesPerSession =
      input?.maxOccurrencesPerSession ?? adminLeagueDetailMaxOccurrencesDefault
    const isMaxOccurrencesPerSessionValid =
      Number.isInteger(maxOccurrencesPerSession) && maxOccurrencesPerSession >= 1
    if (!isMaxOccurrencesPerSessionValid) {
      throw new Error(errorAdminLeagueDetailMaxOccurrencesInvalid)
    }

    const occurrenceStart = input?.occurrenceStart ?? null
    const occurrenceEnd = input?.occurrenceEnd ?? null
    if (occurrenceStart && occurrenceEnd && occurrenceStart > occurrenceEnd) {
      throw new Error(errorAdminLeagueDetailOccurrenceRangeInvalid)
    }

    return {
      includeArchivedSessions: input?.includeArchivedSessions ?? true,
      includeCanceledOccurrences: input?.includeCanceledOccurrences ?? true,
      occurrenceStart,
      occurrenceEnd,
      maxOccurrencesPerSession
    }
  }

  private buildAdminLeagueDetailInputCacheKey(
    input: NormalizedAdminLeagueDetailInput
  ): string {
    return JSON.stringify({
      includeArchivedSessions: input.includeArchivedSessions,
      includeCanceledOccurrences: input.includeCanceledOccurrences,
      occurrenceStart: input.occurrenceStart?.toISOString() ?? null,
      occurrenceEnd: input.occurrenceEnd?.toISOString() ?? null,
      maxOccurrencesPerSession: input.maxOccurrencesPerSession
    })
  }

  public getAdminLeagueDetailInputCacheKey(
    input: AdminLeagueDetailInput | null | undefined
  ): string {
    const normalizedInput = this.normalizeAdminLeagueDetailInput(input)
    return this.buildAdminLeagueDetailInputCacheKey(normalizedInput)
  }

  private buildOccurrenceWhereBySessionIds(
    sessionIds: string[],
    input: NormalizedAdminLeagueDetailInput
  ): Prisma.SessionOccurrenceWhereInput {
    const startsAtFilter: Prisma.DateTimeFilter = {}
    if (input.occurrenceStart) {
      startsAtFilter.gte = input.occurrenceStart
    }
    if (input.occurrenceEnd) {
      startsAtFilter.lte = input.occurrenceEnd
    }

    return {
      sessionId: { in: sessionIds },
      ...(input.includeCanceledOccurrences
        ? {}
        : { status: { not: occurrenceStatusCanceled } }),
      ...(Object.keys(startsAtFilter).length === 0
        ? {}
        : { startsAt: startsAtFilter })
    }
  }

  private compareAssignmentsByUser(
    left: AdminSlotAssignmentWithUser,
    right: AdminSlotAssignmentWithUser
  ): number {
    const leftDisplayName = left.user.displayName?.trim() || null
    const rightDisplayName = right.user.displayName?.trim() || null

    if (leftDisplayName && rightDisplayName) {
      const nameCompare = leftDisplayName.localeCompare(rightDisplayName, 'en', {
        sensitivity: 'base'
      })
      if (nameCompare !== 0) {
        return nameCompare
      }
    } else if (leftDisplayName && !rightDisplayName) {
      return -1
    } else if (!leftDisplayName && rightDisplayName) {
      return 1
    }

    return left.user.phoneNumber.localeCompare(right.user.phoneNumber, 'en', {
      sensitivity: 'base'
    })
  }

  private async loadCappedOccurrencesBySessionIds(
    sessionIds: string[],
    input: NormalizedAdminLeagueDetailInput
  ): Promise<RankedOccurrenceRow[]> {
    if (sessionIds.length === 0) {
      return []
    }

    const sessionIdParams = sessionIds.map(
      (sessionId) => PrismaClient.sql`${sessionId}::uuid`
    )
    const canceledFilterSql = input.includeCanceledOccurrences
      ? PrismaClient.empty
      : PrismaClient.sql`AND so."status" != ${occurrenceStatusCanceled}`
    const occurrenceStartFilterSql = input.occurrenceStart
      ? PrismaClient.sql`AND so."startsAt" >= ${input.occurrenceStart}`
      : PrismaClient.empty
    const occurrenceEndFilterSql = input.occurrenceEnd
      ? PrismaClient.sql`AND so."startsAt" <= ${input.occurrenceEnd}`
      : PrismaClient.empty

    return prisma.$queryRaw<RankedOccurrenceRow[]>(PrismaClient.sql`
      WITH ranked_occurrences AS (
        SELECT
          so."id",
          so."sessionId",
          so."startsAt",
          so."endsAt",
          so."status",
          so."createdAt",
          so."updatedAt",
          ROW_NUMBER() OVER (
            PARTITION BY so."sessionId"
            ORDER BY so."startsAt" ASC
          ) AS "occurrenceRank"
        FROM "SessionOccurrence" so
        WHERE so."sessionId" IN (${PrismaClient.join(sessionIdParams)})
          ${canceledFilterSql}
          ${occurrenceStartFilterSql}
          ${occurrenceEndFilterSql}
      )
      SELECT
        "id",
        "sessionId",
        "startsAt",
        "endsAt",
        "status",
        "createdAt",
        "updatedAt"
      FROM ranked_occurrences
      WHERE "occurrenceRank" <= ${input.maxOccurrencesPerSession}
      ORDER BY "sessionId" ASC, "startsAt" ASC
    `)
  }

  private normalizeAttendanceConfirmationInputs(
    inputs: AdminSetAttendanceConfirmationInput[]
  ): AdminSetAttendanceConfirmationInput[] {
    const dedupedByUserId = new Map<string, boolean>()
    for (let index = inputs.length - 1; index >= 0; index -= 1) {
      const input = inputs[index]
      if (!dedupedByUserId.has(input.userId)) {
        dedupedByUserId.set(input.userId, input.isConfirmed)
      }
    }

    return Array.from(dedupedByUserId.entries())
      .reverse()
      .map(([userId, isConfirmed]) => ({ userId, isConfirmed }))
  }

  private resolveOccurrenceRosterUserIds(
    registrationUserIds: string[],
    subSignupUserIds: string[]
  ): string[] {
    const rosterUserIds = new Set<string>()
    registrationUserIds.forEach((userId) => {
      rosterUserIds.add(userId)
    })
    subSignupUserIds.forEach((userId) => {
      rosterUserIds.add(userId)
    })
    return Array.from(rosterUserIds)
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
    organizationId: string,
    leagueId?: string
  ): Promise<void> {
    await tx.league.updateMany({
      where: {
        organizationId,
        status: leagueStatusActive,
        ...(leagueId ? { id: { not: leagueId } } : {})
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
      const organization = await tx.organization.findUnique({
        where: { id: input.organizationId },
        select: { id: true }
      })

      if (!organization) {
        throw new Error(errorOrganizationMissing)
      }

      if (leagueStatus === leagueStatusActive) {
        await this.archiveOtherActiveLeagues(tx, input.organizationId)
      }

      const createdLeague = await tx.league.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          status: leagueStatus,
          startDate: input.startDate,
          endDate: input.endDate,
          timeZone: input.timeZone
        }
      })

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
    const nextStatus =
      input.status === undefined ? existingLeague.status : input.status
    this.validateDateRange(nextStartDate, nextEndDate)

    return prisma.$transaction(async (tx) => {
      if (
        nextStatus === leagueStatusActive &&
        existingLeague.status !== leagueStatusActive
      ) {
        await this.archiveOtherActiveLeagues(
          tx,
          existingLeague.organizationId,
          existingLeague.id
        )
      }

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

      return updatedLeague
    })
  }

  public async adminLeagues(input: AdminLeaguesInput) {
    const { limit, offset } = this.resolvePagination(input.pagination)
    const trimmedSearch = input.search?.trim()
    const whereClause: Prisma.LeagueWhereInput = {
      organizationId: input.organizationId,
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

  public async adminLeagueDetailSessions(
    leagueId: string,
    input: AdminLeagueDetailInput | null | undefined
  ): Promise<AdminLeagueDetailSession[]> {
    const normalizedInput = this.normalizeAdminLeagueDetailInput(input)
    const inputKey = this.buildAdminLeagueDetailInputCacheKey(normalizedInput)
    const sessions = await prisma.session.findMany({
      where: {
        leagueId,
        ...(normalizedInput.includeArchivedSessions
          ? {}
          : { status: { not: sessionStatusArchived } })
      },
      orderBy: [
        { weekday: sortOrderAscending },
        { startTimeMinutes: sortOrderAscending },
        { title: sortOrderAscending }
      ]
    })

    if (sessions.length === 0) {
      return []
    }

    const sessionIds = sessions.map((session) => session.id)
    const occurrenceWhere = this.buildOccurrenceWhereBySessionIds(
      sessionIds,
      normalizedInput
    )

    const [assignments, occurrenceCounts, cappedOccurrences] = await Promise.all([
      prisma.slotAssignment.findMany({
        where: { sessionId: { in: sessionIds } },
        include: {
          user: {
            select: {
              id: true,
              phoneNumber: true,
              displayName: true,
              isOnApp: true
            }
          }
        }
      }),
      prisma.sessionOccurrence.groupBy({
        by: ['sessionId'],
        where: occurrenceWhere,
        _count: { _all: true }
      }),
      this.loadCappedOccurrencesBySessionIds(sessionIds, normalizedInput)
    ])

    const occurrenceIds = cappedOccurrences.map((occurrence) => occurrence.id)
    const [attendingCounts, subCounts] =
      occurrenceIds.length === 0
        ? [[], []]
        : await Promise.all([
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
            })
          ])

    const assignmentsBySessionId = new Map<string, AdminSlotAssignmentWithUser[]>()
    for (const assignment of assignments) {
      const existingAssignments =
        assignmentsBySessionId.get(assignment.sessionId) ?? []
      existingAssignments.push(assignment)
      assignmentsBySessionId.set(assignment.sessionId, existingAssignments)
    }
    for (const assignmentsForSession of assignmentsBySessionId.values()) {
      assignmentsForSession.sort((left, right) =>
        this.compareAssignmentsByUser(left, right)
      )
    }

    const occurrenceCountBySessionId = new Map<string, number>()
    for (const occurrenceCount of occurrenceCounts) {
      occurrenceCountBySessionId.set(
        occurrenceCount.sessionId,
        occurrenceCount._count._all
      )
    }

    const attendingCountByOccurrenceId = new Map<string, number>()
    for (const attendingCount of attendingCounts) {
      attendingCountByOccurrenceId.set(
        attendingCount.occurrenceId,
        attendingCount._count._all
      )
    }

    const subCountByOccurrenceId = new Map<string, number>()
    for (const subCount of subCounts) {
      subCountByOccurrenceId.set(subCount.occurrenceId, subCount._count._all)
    }

    const sessionCapacityBySessionId = new Map<string, number>(
      sessions.map((session) => [session.id, session.capacity])
    )
    const occurrencesBySessionId = new Map<string, AdminLeagueDetailOccurrence[]>()
    for (const occurrence of cappedOccurrences) {
      const attendingCount =
        attendingCountByOccurrenceId.get(occurrence.id) ?? paginationOffsetDefault
      const subCount =
        subCountByOccurrenceId.get(occurrence.id) ?? paginationOffsetDefault
      const sessionCapacity =
        sessionCapacityBySessionId.get(occurrence.sessionId) ??
        sessionCapacityDefault
      const occurrenceSummary: AdminLeagueDetailOccurrence = {
        id: occurrence.id,
        sessionId: occurrence.sessionId,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        status: occurrence.status,
        createdAt: occurrence.createdAt,
        updatedAt: occurrence.updatedAt,
        attendingCount,
        subCount,
        openSpots: Math.max(sessionCapacity - attendingCount, paginationOffsetDefault)
      }

      const existingOccurrences =
        occurrencesBySessionId.get(occurrence.sessionId) ?? []
      existingOccurrences.push(occurrenceSummary)
      occurrencesBySessionId.set(occurrence.sessionId, existingOccurrences)
    }

    return sessions.map((session) => ({
      ...session,
      assignmentCount:
        assignmentsBySessionId.get(session.id)?.length ?? paginationOffsetDefault,
      occurrenceCount:
        occurrenceCountBySessionId.get(session.id) ?? paginationOffsetDefault,
      assignments: assignmentsBySessionId.get(session.id) ?? [],
      occurrences: occurrencesBySessionId.get(session.id) ?? [],
      adminLeagueDetailInputKey: inputKey
    }))
  }

  public async adminSessionTemplateAssignmentCount(sessionId: string): Promise<number> {
    return prisma.slotAssignment.count({
      where: { sessionId }
    })
  }

  public async adminSessionTemplateAssignments(
    sessionId: string
  ): Promise<AdminSlotAssignmentWithUser[]> {
    const assignments = await prisma.slotAssignment.findMany({
      where: { sessionId },
      include: {
        user: {
          select: {
            id: true,
            phoneNumber: true,
            displayName: true,
            isOnApp: true
          }
        }
      }
    })

    return assignments.sort((left, right) =>
      this.compareAssignmentsByUser(left, right)
    )
  }

  public async adminSessionTemplateOccurrenceCount(
    sessionId: string,
    input: AdminLeagueDetailInput | null | undefined
  ): Promise<number> {
    const normalizedInput = this.normalizeAdminLeagueDetailInput(input)
    return prisma.sessionOccurrence.count({
      where: this.buildOccurrenceWhereBySessionIds([sessionId], normalizedInput)
    })
  }

  public async adminSessionTemplateOccurrences(
    sessionId: string,
    sessionCapacity: number,
    input: AdminLeagueDetailInput | null | undefined
  ): Promise<AdminLeagueDetailOccurrence[]> {
    const normalizedInput = this.normalizeAdminLeagueDetailInput(input)
    const cappedOccurrences = await this.loadCappedOccurrencesBySessionIds(
      [sessionId],
      normalizedInput
    )

    if (cappedOccurrences.length === 0) {
      return []
    }

    const occurrenceIds = cappedOccurrences.map((occurrence) => occurrence.id)
    const [attendingCounts, subCounts] = await Promise.all([
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
      })
    ])

    const attendingCountByOccurrenceId = new Map<string, number>()
    for (const attendingCount of attendingCounts) {
      attendingCountByOccurrenceId.set(
        attendingCount.occurrenceId,
        attendingCount._count._all
      )
    }

    const subCountByOccurrenceId = new Map<string, number>()
    for (const subCount of subCounts) {
      subCountByOccurrenceId.set(subCount.occurrenceId, subCount._count._all)
    }

    return cappedOccurrences.map((occurrence) => {
      const attendingCount =
        attendingCountByOccurrenceId.get(occurrence.id) ?? paginationOffsetDefault
      const subCount =
        subCountByOccurrenceId.get(occurrence.id) ?? paginationOffsetDefault
      return {
        id: occurrence.id,
        sessionId: occurrence.sessionId,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        status: occurrence.status,
        createdAt: occurrence.createdAt,
        updatedAt: occurrence.updatedAt,
        attendingCount,
        subCount,
        openSpots: Math.max(sessionCapacity - attendingCount, paginationOffsetDefault)
      }
    })
  }

  public async adminPlayers(input: AdminPlayersInput) {
    const { limit, offset } = this.resolvePagination(input.pagination)
    const trimmedSearch = input.search?.trim()
    const whereClause: Prisma.UserWhereInput = {
      AND: [
        {
          OR: [
            {
              organizationMemberships: {
                some: {
                  organizationId: input.organizationId
                }
              }
            },
            {
              leagueMemberships: {
                some: {
                  league: {
                    organizationId: input.organizationId
                  }
                }
              }
            }
          ]
        }
      ],
      ...(input.isOnApp === undefined || input.isOnApp === null
        ? {}
        : { isOnApp: input.isOnApp }),
      ...(trimmedSearch
        ? {
            OR: [
              {
                phoneNumber: {
                  contains: trimmedSearch,
                  mode: 'insensitive'
                }
              },
              {
                displayName: {
                  contains: trimmedSearch,
                  mode: 'insensitive'
                }
              }
            ]
          }
        : {})
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
        },
        attendanceConfirmations: {
          orderBy: { createdAt: sortOrderAscending }
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
        profileImageId: registration.user.profileImageId,
        isOnApp: registration.user.isOnApp,
        roleContextLeagueId: occurrence.session.leagueId
      },
      status: registration.status
    }))

    const subs = occurrence.subSignups.map((subSignup) => ({
      user: {
        id: subSignup.user.id,
        phoneNumber: subSignup.user.phoneNumber,
        displayName: subSignup.user.displayName,
        profileImageId: subSignup.user.profileImageId,
        isOnApp: subSignup.user.isOnApp,
        roleContextLeagueId: occurrence.session.leagueId
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
    const rosterUserIds = this.resolveOccurrenceRosterUserIds(
      occurrence.registrations.map((registration) => registration.userId),
      occurrence.subSignups.map((subSignup) => subSignup.userId)
    )
    const rosterUserIdSet = new Set<string>(rosterUserIds)
    const confirmationByUserId = new Map(
      occurrence.attendanceConfirmations
        .filter((confirmation) => rosterUserIdSet.has(confirmation.userId))
        .map((confirmation) => [confirmation.userId, confirmation])
    )
    const attendanceConfirmations: AdminAttendanceConfirmation[] = rosterUserIds.map(
      (userId) => {
        const confirmation = confirmationByUserId.get(userId)
        if (!confirmation) {
          return {
            userId,
            isConfirmed: false,
            confirmedAt: null,
            confirmedByUserId: null
          }
        }

        return {
          userId: confirmation.userId,
          isConfirmed: true,
          confirmedAt: confirmation.confirmedAt,
          confirmedByUserId: confirmation.confirmedByUserId
        }
      }
    )
    const confirmedCount = attendanceConfirmations.filter(
      (confirmation) => confirmation.isConfirmed
    ).length
    const unconfirmedCount = Math.max(rosterUserIds.length - confirmedCount, 0)

    return {
      occurrenceId: occurrence.id,
      sessionId: occurrence.sessionId,
      occurrenceStatus: occurrence.status,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      openSpots,
      confirmedCount,
      unconfirmedCount,
      attendanceConfirmations,
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
      await tx.leagueMembership.deleteMany({
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
        phoneNumber: normalizedPhoneNumber
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
            displayName: true,
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
      await tx.leagueMembership.upsert({
        where: {
          leagueId_userId: {
            leagueId: input.leagueId,
            userId
          }
        },
        create: {
          leagueId: input.leagueId,
          userId,
          status: leagueMembershipStatusActive
        },
        update: {
          status: leagueMembershipStatusActive
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
          await tx.leagueMembership.upsert({
            where: {
              leagueId_userId: {
                leagueId: input.leagueId,
                userId
              }
            },
            create: {
              leagueId: input.leagueId,
              userId,
              status: leagueMembershipStatusActive
            },
            update: {
              status: leagueMembershipStatusActive
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
      await tx.leagueMembership.upsert({
        where: {
          leagueId_userId: {
            leagueId: assignment.leagueId,
            userId: nextUserId
          }
        },
        create: {
          leagueId: assignment.leagueId,
          userId: nextUserId,
          status: leagueMembershipStatusActive
        },
        update: {
          status: leagueMembershipStatusActive
        }
      })

      return updated.id
    })

    return this.mapSlotAssignment(updatedAssignmentId)
  }

  public async adminCreatePlayer(input: AdminCreatePlayerInput) {
    const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber)
    const nextDisplayName =
      input.displayName === undefined ? undefined : input.displayName
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phoneNumber: normalizedPhoneNumber },
        create: {
          phoneNumber: normalizedPhoneNumber,
          displayName: input.displayName ?? null
        },
        update: {
          displayName: nextDisplayName
        }
      })

      await tx.leagueMembership.upsert({
        where: {
          leagueId_userId: {
            leagueId: input.leagueId,
            userId: user.id
          }
        },
        create: {
          leagueId: input.leagueId,
          userId: user.id,
          status: leagueMembershipStatusActive
        },
        update: {
          status: leagueMembershipStatusActive
        }
      })

      return user
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

    const playerInOrganization = await prisma.user.findFirst({
      where: {
        id: playerId,
        OR: [
          {
            organizationMemberships: {
              some: {
                organizationId: input.organizationId
              }
            }
          },
          {
            leagueMemberships: {
              some: {
                league: {
                  organizationId: input.organizationId
                }
              }
            }
          }
        ]
      },
      select: { id: true }
    })

    if (!playerInOrganization) {
      throw new Error(errorPlayerNotInOrganization)
    }

    const normalizedPhoneNumber = input.phoneNumber
      ? normalizePhoneNumber(input.phoneNumber)
      : undefined
    const nextDisplayName =
      input.displayName === undefined ? undefined : input.displayName

    return prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: playerId },
        data: {
          phoneNumber: normalizedPhoneNumber,
          displayName: nextDisplayName
        }
      })

      if (input.role !== undefined && input.role !== null) {
        if (input.role === userRoleOwner) {
          throw new Error(errorOwnerRoleAssignmentNotAllowed)
        }

        const existingMembership = await tx.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: playerId
            }
          },
          select: {
            role: true
          }
        })

        if (existingMembership?.role === organizationMembershipRoleOwner) {
          throw new Error(errorOwnerRoleChangeNotAllowed)
        }

        if (input.role === userRoleAdmin) {
          await tx.organizationMembership.upsert({
            where: {
              organizationId_userId: {
                organizationId: input.organizationId,
                userId: playerId
              }
            },
            create: {
              organizationId: input.organizationId,
              userId: playerId,
              role: organizationMembershipRoleAdmin
            },
            update: {
              role: organizationMembershipRoleAdmin
            }
          })
        }

        if (input.role === userRolePlayer && existingMembership) {
          await tx.organizationMembership.delete({
            where: {
              organizationId_userId: {
                organizationId: input.organizationId,
                userId: playerId
              }
            }
          })
        }
      }

      return updatedUser
    })
  }

  public async adminSetLeagueMembership(
    input: AdminSetLeagueMembershipInput
  ): Promise<AdminLeagueMembership> {
    const [league, user] = await prisma.$transaction([
      prisma.league.findUnique({
        where: { id: input.leagueId },
        select: { id: true }
      }),
      prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true }
      })
    ])

    if (!league) {
      throw new Error(errorLeagueMissing)
    }

    if (!user) {
      throw new Error(errorPlayerMissing)
    }

    return prisma.leagueMembership.upsert({
      where: {
        leagueId_userId: {
          leagueId: input.leagueId,
          userId: input.userId
        }
      },
      create: {
        leagueId: input.leagueId,
        userId: input.userId,
        status: input.status
      },
      update: {
        status: input.status
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

  public async adminSetAttendanceConfirmation(
    occurrenceId: string,
    userId: string,
    isConfirmed: boolean,
    actorUserId: string
  ): Promise<AdminAttendanceConfirmation> {
    const confirmations = await this.adminSetAttendanceConfirmations(
      occurrenceId,
      [{ userId, isConfirmed }],
      actorUserId
    )

    const [confirmation] = confirmations
    if (!confirmation) {
      throw new Error(errorPlayerNotInOccurrenceRoster)
    }

    return confirmation
  }

  public async adminSetAttendanceConfirmations(
    occurrenceId: string,
    inputs: AdminSetAttendanceConfirmationInput[],
    actorUserId: string
  ): Promise<AdminAttendanceConfirmation[]> {
    const normalizedInputs = this.normalizeAttendanceConfirmationInputs(inputs)
    if (normalizedInputs.length === 0) {
      return []
    }

    return prisma.$transaction(async (tx) => {
      const occurrence = await tx.sessionOccurrence.findUnique({
        where: { id: occurrenceId },
        select: { id: true }
      })
      if (!occurrence) {
        throw new Error(errorOccurrenceMissing)
      }

      const [registrations, subSignups] = await Promise.all([
        tx.sessionRegistration.findMany({
          where: { occurrenceId },
          select: { userId: true }
        }),
        tx.subSignup.findMany({
          where: { occurrenceId },
          select: { userId: true }
        })
      ])

      const rosterUserIds = this.resolveOccurrenceRosterUserIds(
        registrations.map((registration) => registration.userId),
        subSignups.map((subSignup) => subSignup.userId)
      )
      const rosterUserIdSet = new Set<string>(rosterUserIds)
      for (const input of normalizedInputs) {
        if (!rosterUserIdSet.has(input.userId)) {
          throw new Error(errorPlayerNotInOccurrenceRoster)
        }
      }

      const now = new Date()
      const confirmations: AdminAttendanceConfirmation[] = []
      for (const input of normalizedInputs) {
        if (!input.isConfirmed) {
          await tx.occurrenceAttendanceConfirmation.deleteMany({
            where: {
              occurrenceId,
              userId: input.userId
            }
          })
          confirmations.push({
            userId: input.userId,
            isConfirmed: false,
            confirmedAt: null,
            confirmedByUserId: null
          })
          continue
        }

        const confirmation = await tx.occurrenceAttendanceConfirmation.upsert({
          where: {
            occurrenceId_userId: {
              occurrenceId,
              userId: input.userId
            }
          },
          create: {
            occurrenceId,
            userId: input.userId,
            confirmedAt: now,
            confirmedByUserId: actorUserId
          },
          update: {
            confirmedAt: now,
            confirmedByUserId: actorUserId
          },
          select: {
            userId: true,
            confirmedAt: true,
            confirmedByUserId: true
          }
        })

        confirmations.push({
          userId: confirmation.userId,
          isConfirmed: true,
          confirmedAt: confirmation.confirmedAt,
          confirmedByUserId: confirmation.confirmedByUserId
        })
      }

      return confirmations
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
        select: {
          id: true,
          status: true,
          session: {
            select: {
              leagueId: true
            }
          }
        }
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    ])

    if (!occurrence) {
      throw new Error(errorOccurrenceMissing)
    }

    if (!user) {
      throw new Error(errorPlayerMissing)
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
      throw new Error(errorActiveLeagueMembershipRequired)
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
        select: {
          id: true,
          status: true,
          session: {
            select: {
              leagueId: true
            }
          }
        }
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
      throw new Error(errorActiveLeagueMembershipRequired)
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
