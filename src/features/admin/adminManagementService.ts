import type {
  LeagueStatus,
  Prisma,
  SessionOccurrenceStatus,
  SessionStatus,
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
const deleteActionDeleted = 'DELETED'
const deleteActionArchived = 'ARCHIVED'
const deleteActionCanceled = 'CANCELED'
const minutesPerDay = 24 * 60
const errorLeagueMissing = 'League missing'
const errorSessionMissing = 'Session missing'
const errorOccurrenceMissing = 'Session occurrence missing'
const errorSlotAssignmentMissing = 'Slot assignment missing'
const errorSessionLeagueMismatch = 'Session does not belong to league'
const errorSessionArchived = 'Session is archived'
const errorStartBeforeEnd = 'startsAt must be before endsAt'
const errorDateRangeInvalid = 'startDate must be before endDate'
const errorTimeRangeInvalid = 'startTimeMinutes must be before endTimeMinutes'
const errorMinuteBounds = 'Session minutes must be within a 0-1439 range'
const errorSessionCapacityInvalid = 'Session capacity must be greater than zero'
const errorDuplicateAssignment = 'User already has a slot assignment in this league'

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
  private validateDateRange(startDate: Date | null | undefined, endDate: Date | null | undefined): void {
    if (startDate && endDate && startDate >= endDate) {
      throw new Error(errorDateRangeInvalid)
    }
  }

  private validateSessionTimes(startTimeMinutes: number, endTimeMinutes: number): void {
    const startsInRange = startTimeMinutes >= 0 && startTimeMinutes < minutesPerDay
    const endsInRange = endTimeMinutes >= 0 && endTimeMinutes < minutesPerDay
    if (!startsInRange || !endsInRange) {
      throw new Error(errorMinuteBounds)
    }

    if (startTimeMinutes >= endTimeMinutes) {
      throw new Error(errorTimeRangeInvalid)
    }
  }

  private async archiveOtherActiveLeagues(tx: TransactionClient, leagueId: string): Promise<void> {
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

    const nextStartDate = input.startDate === undefined ? existingLeague.startDate : input.startDate
    const nextEndDate = input.endDate === undefined ? existingLeague.endDate : input.endDate
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

    const nextStartTimeMinutes = input.startTimeMinutes ?? session.startTimeMinutes
    const nextEndTimeMinutes = input.endTimeMinutes ?? session.endTimeMinutes
    this.validateSessionTimes(nextStartTimeMinutes, nextEndTimeMinutes)

    if (input.capacity !== undefined && input.capacity !== null && input.capacity <= 0) {
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

  private async createOccurrenceInTransaction(tx: TransactionClient, input: CreateSessionOccurrenceInput) {
    if (input.startsAt >= input.endsAt) {
      throw new Error(errorStartBeforeEnd)
    }

    const session = await tx.session.findUnique({
      where: { id: input.sessionId },
      select: { id: true, status: true }
    })

    if (!session) {
      throw new Error(errorSessionMissing)
    }

    if (session.status === sessionStatusArchived) {
      throw new Error(errorSessionArchived)
    }

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
    return prisma.$transaction(async (tx) => this.createOccurrenceInTransaction(tx, input))
  }

  public async createSessionOccurrences(inputs: CreateSessionOccurrenceInput[]) {
    return prisma.$transaction(async (tx) => {
      const createdOccurrences = []

      for (const [index, input] of inputs.entries()) {
        try {
          const created = await this.createOccurrenceInTransaction(tx, input)
          createdOccurrences.push(created)
        } catch (error) {
          throw new Error(`Occurrence at index ${String(index)}: ${getErrorMessage(error)}`)
        }
      }

      return createdOccurrences
    })
  }

  public async updateSessionOccurrence(occurrenceId: string, input: UpdateSessionOccurrenceInput) {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      select: {
        id: true,
        startsAt: true,
        endsAt: true
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

  public async deleteSessionOccurrence(occurrenceId: string): Promise<AdminDeleteOutcome> {
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

    const hasHistory = occurrence._count.registrations > 0 || occurrence._count.subSignups > 0
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

  private async upsertUserFromPhoneNumber(tx: TransactionClient, phoneNumber: string): Promise<string> {
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
      await this.getSessionForAssignmentValidation(tx, input.leagueId, input.sessionId)
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
          await this.getSessionForAssignmentValidation(tx, input.leagueId, input.sessionId)
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
          ids.push(assignment.id)
        } catch (error) {
          throw new Error(`Slot assignment at index ${String(index)}: ${getErrorMessage(error)}`)
        }
      }

      return ids
    })

    return Promise.all(assignmentIds.map((assignmentId) => this.mapSlotAssignment(assignmentId)))
  }

  public async updateSlotAssignment(slotAssignmentId: string, input: UpdateSlotAssignmentInput) {
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
        await this.getSessionForAssignmentValidation(tx, assignment.leagueId, input.sessionId)
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

        if (conflictingAssignment && conflictingAssignment.id !== assignment.id) {
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

  public async deleteSlotAssignment(slotAssignmentId: string): Promise<AdminDeleteOutcome> {
    await prisma.slotAssignment.delete({
      where: { id: slotAssignmentId }
    })

    return {
      id: slotAssignmentId,
      action: deleteActionDeleted
    }
  }
}
