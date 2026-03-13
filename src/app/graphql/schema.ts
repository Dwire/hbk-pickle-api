import { makeExecutableSchema } from '@graphql-tools/schema'
import { GraphQLDateTime } from 'graphql-scalars'
import { Kind } from 'graphql'
import type { GraphQLScalarType, ValueNode } from 'graphql'

import { AdminManagementService } from '../../features/admin/adminManagementService.js'
import { AuthService } from '../../features/auth/authService.js'
import { RegistrationService } from '../../features/registrations/registrationService.js'
import { RuleService } from '../../features/rules/ruleService.js'
import { SessionService } from '../../features/sessions/sessionService.js'
import { SubSignupService } from '../../features/subs/subSignupService.js'
import { UserService } from '../../features/users/userService.js'
import type { LeagueStatus, SessionOccurrenceStatus, SessionStatus, Weekday } from '../../generated/prisma/client.js'
import type { AppContext } from '../context.js'
import { requireAdmin, requireAuth } from '../auth.js'

const utcDateTimeErrorInvalid = 'DateTime must be a UTC ISO-8601 value with a Z or +00:00 offset'

const normalizeUtcIsoString = (value: string): string => {
  const trimmed = value.trim()
  const utcPattern = /Z$|\+00:00$/
  if (!utcPattern.test(trimmed)) {
    throw new Error(utcDateTimeErrorInvalid)
  }

  return trimmed
}

const coerceUtcDateTime = (value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value !== 'string') {
    throw new Error(utcDateTimeErrorInvalid)
  }

  const normalized = normalizeUtcIsoString(value)
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(utcDateTimeErrorInvalid)
  }

  return parsed
}

const utcDateTimeScalar: GraphQLScalarType = GraphQLDateTime as GraphQLScalarType

utcDateTimeScalar.serialize = (value: unknown): string => {
  const parsed = coerceUtcDateTime(value)
  return parsed.toISOString()
}

utcDateTimeScalar.parseValue = (value: unknown): Date => {
  return coerceUtcDateTime(value)
}

utcDateTimeScalar.parseLiteral = (ast: ValueNode): Date => {
  if (ast.kind !== Kind.STRING) {
    throw new Error(utcDateTimeErrorInvalid)
  }

  return coerceUtcDateTime(ast.value)
}

const typeDefs = `#graphql
  scalar DateTime

  enum UserRole {
    PLAYER
    ADMIN
  }

  enum LeagueStatus {
    DRAFT
    UPCOMING
    ACTIVE
    ARCHIVED
  }

  enum SessionStatus {
    ACTIVE
    ARCHIVED
  }

  enum RegistrationStatus {
    ATTENDING
    DECLINED
    CANCELED
  }

  enum SubSignupStatus {
    ACTIVE
    CANCELED
    SELECTED
    REPLACED
  }

  enum SessionDisplayState {
    PAST
    LIVE
    UPCOMING
  }

  enum SessionOccurrenceStatus {
    ACTIVE
    CANCELED
  }

  enum Weekday {
    MONDAY
    TUESDAY
    WEDNESDAY
    THURSDAY
    FRIDAY
    SATURDAY
    SUNDAY
  }

  type User {
    id: ID!
    phoneNumber: String!
    displayName: String
    isOnApp: Boolean!
    role: UserRole!
  }

  type ProfileStatsLeague {
    id: ID!
    name: String!
  }

  type ProfileStats {
    currentLeague: ProfileStatsLeague
    leaguesParticipated: [ProfileStatsLeague!]!
    subSignupCount: Int!
    subSelectedCount: Int!
    attendanceCount: Int!
    missedCount: Int!
  }

  type League {
    id: ID!
    name: String!
    status: LeagueStatus!
    startDate: DateTime
    endDate: DateTime
    timeZone: String
  }

  type LeagueRule {
    id: ID!
    title: String!
    body: String!
    order: Int!
  }

  type Session {
    id: ID!
    sessionId: ID!
    occurrenceStatus: SessionOccurrenceStatus!
    title: String!
    weekday: Weekday!
    startTimeMinutes: Int!
    endTimeMinutes: Int!
    startTime: DateTime!
    endTime: DateTime!
    capacity: Int!
    registrationOpenAt: DateTime!
    registrationCloseAt: DateTime!
    registrationStatus: RegistrationStatus
    subSignupStatus: SubSignupStatus
    isUserAssignedToSession: Boolean!
    attendingCount: Int!
    subCount: Int!
    registeredUsers: [SessionParticipant!]!
    subUsers: [SessionParticipant!]!
    displayState: SessionDisplayState!
    liveOpensAt: DateTime!
  }

  type SessionParticipant {
    id: ID!
    displayName: String
    profileImageUrl: String
  }

  type SessionRegistration {
    id: ID!
    status: RegistrationStatus!
  }

  type SubSignup {
    id: ID!
    status: SubSignupStatus!
    selectionRank: Int
    selectedAt: DateTime
  }

  type Notification {
    id: ID!
    title: String!
    body: String!
    status: String!
    kind: String!
    payload: String
  }

  type SessionRosterEntry {
    user: User!
    status: String!
    selectionRank: Int
  }

  type SessionOccurrenceDetail {
    occurrenceId: ID!
    attendees: [SessionRosterEntry!]!
    subs: [SessionRosterEntry!]!
    openSpots: Int!
    registrationOpenAt: DateTime!
    registrationCloseAt: DateTime!
    canRegister: Boolean!
    canSub: Boolean!
    isRegistrationOpen: Boolean!
    isUserAssignedToSession: Boolean!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type AdminLeague {
    id: ID!
    name: String!
    status: LeagueStatus!
    startDate: DateTime
    endDate: DateTime
    timeZone: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AdminSessionTemplate {
    id: ID!
    leagueId: ID!
    title: String!
    weekday: Weekday!
    startTimeMinutes: Int!
    endTimeMinutes: Int!
    capacity: Int!
    status: SessionStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AdminSessionOccurrence {
    id: ID!
    sessionId: ID!
    startsAt: DateTime!
    endsAt: DateTime!
    status: SessionOccurrenceStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AdminSlotAssignment {
    id: ID!
    leagueId: ID!
    sessionId: ID!
    userId: ID!
    userPhoneNumber: String!
    isUserOnApp: Boolean!
    createdAt: DateTime!
  }

  enum AdminDeleteAction {
    DELETED
    CANCELED
    ARCHIVED
  }

  type AdminDeleteOutcome {
    id: ID!
    action: AdminDeleteAction!
  }

  input AdminCreateLeagueInput {
    name: String!
    status: LeagueStatus
    startDate: DateTime
    endDate: DateTime
    timeZone: String
  }

  input AdminUpdateLeagueInput {
    name: String
    status: LeagueStatus
    startDate: DateTime
    endDate: DateTime
    timeZone: String
  }

  input AdminCreateSessionInput {
    leagueId: ID!
    title: String!
    weekday: Weekday!
    startTimeMinutes: Int!
    endTimeMinutes: Int!
    capacity: Int
    status: SessionStatus
  }

  input AdminUpdateSessionInput {
    title: String
    weekday: Weekday
    startTimeMinutes: Int
    endTimeMinutes: Int
    capacity: Int
    status: SessionStatus
  }

  input AdminCreateSessionOccurrenceInput {
    sessionId: ID!
    startsAt: DateTime!
    endsAt: DateTime!
    status: SessionOccurrenceStatus
  }

  input AdminUpdateSessionOccurrenceInput {
    startsAt: DateTime
    endsAt: DateTime
    status: SessionOccurrenceStatus
  }

  input AdminCreateSlotAssignmentInput {
    leagueId: ID!
    sessionId: ID!
    phoneNumber: String!
  }

  input AdminUpdateSlotAssignmentInput {
    sessionId: ID
    phoneNumber: String
  }

  type Query {
    me: User
    league: League
    rules: [LeagueRule!]!
    sessionsWeek: [Session!]!
    sessionOccurrenceDetail(occurrenceId: ID!): SessionOccurrenceDetail!
    profileStats: ProfileStats!
  }

  type Mutation {
    requestPhoneVerification(phoneNumber: String!): Boolean!
    verifyPhoneCode(phoneNumber: String!, code: String!): AuthPayload!
    registerDevice(token: String!, platform: String!): Boolean!
    updateDisplayName(displayName: String!): User!

    registerForSession(occurrenceId: ID!): SessionRegistration!
    cancelRegistration(occurrenceId: ID!): SessionRegistration!
    signupAsSub(occurrenceId: ID!): SubSignup!
    cancelSubSignup(occurrenceId: ID!): SubSignup!

    adminCreateLeague(input: AdminCreateLeagueInput!): AdminLeague!
    adminUpdateLeague(leagueId: ID!, input: AdminUpdateLeagueInput!): AdminLeague!
    adminDeleteLeague(leagueId: ID!): AdminDeleteOutcome!

    adminCreateSession(input: AdminCreateSessionInput!): AdminSessionTemplate!
    adminUpdateSession(sessionId: ID!, input: AdminUpdateSessionInput!): AdminSessionTemplate!
    adminDeleteSession(sessionId: ID!): AdminDeleteOutcome!

    adminCreateSessionOccurrence(input: AdminCreateSessionOccurrenceInput!): AdminSessionOccurrence!
    adminCreateSessionOccurrences(inputs: [AdminCreateSessionOccurrenceInput!]!): [AdminSessionOccurrence!]!
    adminUpdateSessionOccurrence(occurrenceId: ID!, input: AdminUpdateSessionOccurrenceInput!): AdminSessionOccurrence!
    adminDeleteSessionOccurrence(occurrenceId: ID!): AdminDeleteOutcome!

    adminCreateSlotAssignment(input: AdminCreateSlotAssignmentInput!): AdminSlotAssignment!
    adminCreateSlotAssignments(inputs: [AdminCreateSlotAssignmentInput!]!): [AdminSlotAssignment!]!
    adminUpdateSlotAssignment(slotAssignmentId: ID!, input: AdminUpdateSlotAssignmentInput!): AdminSlotAssignment!
    adminDeleteSlotAssignment(slotAssignmentId: ID!): AdminDeleteOutcome!

    adminUpsertRule(title: String!, body: String!, order: Int!): LeagueRule!
  }
`

const resolvers = {
  DateTime: utcDateTimeScalar,
  Session: {
    registeredUsers: (session: { registeredUsers?: unknown[] | null }) => session.registeredUsers ?? [],
    subUsers: (session: { subUsers?: unknown[] | null }) => session.subUsers ?? []
  },
  AdminSlotAssignment: {
    userPhoneNumber: (assignment: { user: { phoneNumber: string } }) => assignment.user.phoneNumber,
    isUserOnApp: (assignment: { user: { isOnApp: boolean } }) => assignment.user.isOnApp
  },
  Query: {
    me: (_: unknown, __: unknown, context: AppContext) => {
      return context.request.userId ? context.prisma.user.findUnique({ where: { id: context.request.userId } }) : null
    },
    league: async (_: unknown, __: unknown, context: AppContext) => {
      return (
        (await context.prisma.league.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' }
        })) ??
        (await context.prisma.league.findFirst({
          orderBy: { createdAt: 'asc' }
        }))
      )
    },
    rules: (_: unknown, __: unknown, context: AppContext) => {
      const ruleService = new RuleService()
      return ruleService.listRules(context.request.userId)
    },
    sessionsWeek: async (_: unknown, __: unknown, context: AppContext) => {
      const sessionService = new SessionService()
      return sessionService.listSessionsWeek(context.request.userId)
    },
    sessionOccurrenceDetail: async (_: unknown, args: { occurrenceId: string }, context: AppContext) => {
      const sessionService = new SessionService()
      return sessionService.getOccurrenceDetail(args.occurrenceId, context.request.userId)
    },
    profileStats: async (_: unknown, __: unknown, context: AppContext) => {
      const userId = requireAuth(context)
      const userService = new UserService()
      return userService.getProfileStats(userId)
    }
  },
  Mutation: {
    requestPhoneVerification: async (_: unknown, args: { phoneNumber: string }) => {
      const authService = new AuthService()
      await authService.requestPhoneVerification(args.phoneNumber)
      return true
    },
    verifyPhoneCode: async (_: unknown, args: { phoneNumber: string; code: string }, context: AppContext) => {
      const authService = new AuthService()
      const result = await authService.verifyPhoneCode(args.phoneNumber, args.code)
      const user = await context.prisma.user.findUnique({ where: { id: result.userId } })

      if (!user) {
        throw new Error('User missing after verification')
      }

      return {
        token: result.token,
        user
      }
    },
    registerDevice: async (_: unknown, args: { token: string; platform: string }, context: AppContext) => {
      const userId = requireAuth(context)
      await context.prisma.userDevice.upsert({
        where: { token: args.token },
        create: { token: args.token, platform: args.platform, userId },
        update: { platform: args.platform, userId }
      })
      return true
    },
    updateDisplayName: async (_: unknown, args: { displayName: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new UserService()
      return service.upsertDisplayName(userId, args.displayName)
    },
    registerForSession: async (_: unknown, args: { occurrenceId: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new RegistrationService()
      return service.register(userId, args.occurrenceId)
    },
    cancelRegistration: async (_: unknown, args: { occurrenceId: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new RegistrationService()
      return service.cancel(userId, args.occurrenceId)
    },
    signupAsSub: async (_: unknown, args: { occurrenceId: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new SubSignupService()
      return service.signup(userId, args.occurrenceId)
    },
    cancelSubSignup: async (_: unknown, args: { occurrenceId: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new SubSignupService()
      return service.cancel(userId, args.occurrenceId)
    },
    adminCreateLeague: async (
      _: unknown,
      args: { input: { name: string; status?: LeagueStatus; startDate?: Date | null; endDate?: Date | null; timeZone?: string | null } },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.createLeague(args.input)
    },
    adminUpdateLeague: async (
      _: unknown,
      args: {
        leagueId: string
        input: { name?: string; status?: LeagueStatus; startDate?: Date | null; endDate?: Date | null; timeZone?: string | null }
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.updateLeague(args.leagueId, args.input)
    },
    adminDeleteLeague: async (_: unknown, args: { leagueId: string }, context: AppContext) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.deleteLeague(args.leagueId)
    },
    adminCreateSession: async (
      _: unknown,
      args: {
        input: {
          leagueId: string
          title: string
          weekday: Weekday
          startTimeMinutes: number
          endTimeMinutes: number
          capacity?: number | null
          status?: SessionStatus
        }
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.createSession(args.input)
    },
    adminUpdateSession: async (
      _: unknown,
      args: {
        sessionId: string
        input: {
          title?: string
          weekday?: Weekday
          startTimeMinutes?: number
          endTimeMinutes?: number
          capacity?: number | null
          status?: SessionStatus
        }
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.updateSession(args.sessionId, args.input)
    },
    adminDeleteSession: async (_: unknown, args: { sessionId: string }, context: AppContext) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.deleteSession(args.sessionId)
    },
    adminCreateSessionOccurrence: async (
      _: unknown,
      args: {
        input: {
          sessionId: string
          startsAt: Date
          endsAt: Date
          status?: SessionOccurrenceStatus
        }
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.createSessionOccurrence(args.input)
    },
    adminCreateSessionOccurrences: async (
      _: unknown,
      args: {
        inputs: Array<{
          sessionId: string
          startsAt: Date
          endsAt: Date
          status?: SessionOccurrenceStatus
        }>
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.createSessionOccurrences(args.inputs)
    },
    adminUpdateSessionOccurrence: async (
      _: unknown,
      args: {
        occurrenceId: string
        input: {
          startsAt?: Date
          endsAt?: Date
          status?: SessionOccurrenceStatus
        }
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.updateSessionOccurrence(args.occurrenceId, args.input)
    },
    adminDeleteSessionOccurrence: async (_: unknown, args: { occurrenceId: string }, context: AppContext) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.deleteSessionOccurrence(args.occurrenceId)
    },
    adminCreateSlotAssignment: async (
      _: unknown,
      args: {
        input: {
          leagueId: string
          sessionId: string
          phoneNumber: string
        }
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.createSlotAssignment(args.input)
    },
    adminCreateSlotAssignments: async (
      _: unknown,
      args: {
        inputs: Array<{
          leagueId: string
          sessionId: string
          phoneNumber: string
        }>
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.createSlotAssignments(args.inputs)
    },
    adminUpdateSlotAssignment: async (
      _: unknown,
      args: {
        slotAssignmentId: string
        input: {
          sessionId?: string
          phoneNumber?: string
        }
      },
      context: AppContext
    ) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.updateSlotAssignment(args.slotAssignmentId, args.input)
    },
    adminDeleteSlotAssignment: async (_: unknown, args: { slotAssignmentId: string }, context: AppContext) => {
      await requireAdmin(context)
      const adminService = new AdminManagementService()
      return adminService.deleteSlotAssignment(args.slotAssignmentId)
    },
    adminUpsertRule: async (_: unknown, args: { title: string; body: string; order: number }, context: AppContext) => {
      await requireAdmin(context)
      const service = new RuleService()
      return service.upsertRule(args.title, args.body, args.order)
    }
  }
}

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers
})
