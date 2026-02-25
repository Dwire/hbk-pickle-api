import { makeExecutableSchema } from '@graphql-tools/schema'
import { GraphQLDateTime } from 'graphql-scalars'

import { AuthService } from '../../features/auth/authService.js'
import { RegistrationService } from '../../features/registrations/registrationService.js'
import { RuleService } from '../../features/rules/ruleService.js'
import { SessionService } from '../../features/sessions/sessionService.js'
import { SubSignupService } from '../../features/subs/subSignupService.js'
import type { AppContext } from '../context.js'
import { requireAuth } from '../auth.js'

const typeDefs = `#graphql
  scalar DateTime

  enum UserRole {
    PLAYER
    ADMIN
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

  type User {
    id: ID!
    phoneNumber: String!
    displayName: String
    role: UserRole!
  }

  type League {
    id: ID!
    name: String!
  }

  type LeagueRule {
    id: ID!
    title: String!
    body: String!
    order: Int!
  }

  type Session {
    id: ID!
    title: String!
    startTime: DateTime!
    endTime: DateTime!
    capacity: Int!
    registrationOpenAt: DateTime!
    registrationCloseAt: DateTime!
    registrationStatus: RegistrationStatus
    subSignupStatus: SubSignupStatus
    attendingCount: Int!
    subCount: Int!
  }

  type SessionRegistration {
    id: ID!
    status: RegistrationStatus!
  }

  type SubSignup {
    id: ID!
    status: SubSignupStatus!
  }

  type Notification {
    id: ID!
    title: String!
    body: String!
    status: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type Query {
    me: User
    league: League
    rules: [LeagueRule!]!
    sessions(start: DateTime!, end: DateTime!): [Session!]!
  }

  type Mutation {
    requestPhoneVerification(phoneNumber: String!): Boolean!
    verifyPhoneCode(phoneNumber: String!, code: String!): AuthPayload!
    registerDevice(token: String!, platform: String!): Boolean!

    registerForSession(sessionId: ID!): SessionRegistration!
    cancelRegistration(sessionId: ID!): SessionRegistration!
    signupAsSub(sessionId: ID!): SubSignup!
    cancelSubSignup(sessionId: ID!): SubSignup!

    adminCreateSession(title: String!, startTime: DateTime!, endTime: DateTime!, capacity: Int): Session!
    adminAssignPlayer(sessionId: ID!, userId: ID!): Boolean!
    adminUpsertRule(title: String!, body: String!, order: Int!): LeagueRule!
  }
`

const resolvers = {
  DateTime: GraphQLDateTime,
  Query: {
    me: (_: unknown, __: unknown, context: AppContext) => {
      return context.request.userId ? context.prisma.user.findUnique({ where: { id: context.request.userId } }) : null
    },
    league: (_: unknown, __: unknown, context: AppContext) => {
      return context.prisma.league.findFirst()
    },
    rules: (_: unknown, __: unknown, _context: AppContext) => {
      const ruleService = new RuleService()
      return ruleService.listRules()
    },
    sessions: async (_: unknown, args: { start: Date; end: Date }, _context: AppContext) => {
      const sessionService = new SessionService()
      return sessionService.listSessions(args.start, args.end)
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
    registerForSession: async (_: unknown, args: { sessionId: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new RegistrationService()
      return service.register(userId, args.sessionId)
    },
    cancelRegistration: async (_: unknown, args: { sessionId: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new RegistrationService()
      return service.cancel(userId, args.sessionId)
    },
    signupAsSub: async (_: unknown, args: { sessionId: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new SubSignupService()
      return service.signup(userId, args.sessionId)
    },
    cancelSubSignup: async (_: unknown, args: { sessionId: string }, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new SubSignupService()
      return service.cancel(userId, args.sessionId)
    },
    adminCreateSession: async (_: unknown, args: { title: string; startTime: Date; endTime: Date; capacity?: number }) => {
      const service = new SessionService()
      return service.createSession(args.title, args.startTime, args.endTime, args.capacity)
    },
    adminAssignPlayer: async (_: unknown, args: { sessionId: string; userId: string }, context: AppContext) => {
      const league = await context.prisma.league.findFirst()

      if (!league) {
        throw new Error('League missing')
      }

      await context.prisma.slotAssignment.upsert({
        where: { userId: args.userId },
        create: { userId: args.userId, sessionId: args.sessionId, leagueId: league.id },
        update: { sessionId: args.sessionId }
      })
      return true
    },
    adminUpsertRule: async (_: unknown, args: { title: string; body: string; order: number }) => {
      const service = new RuleService()
      return service.upsertRule(args.title, args.body, args.order)
    }
  }
}

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers
})
