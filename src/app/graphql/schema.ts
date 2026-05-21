import { makeExecutableSchema } from '@graphql-tools/schema'
import { GraphQLDateTime } from 'graphql-scalars'
import { Kind } from 'graphql'
import type { GraphQLScalarType, ValueNode } from 'graphql'

import { AdminManagementService } from '../../features/admin/adminManagementService.js'
import type {
  AdminLeagueDetailInput,
  AdminLeagueDetailSession,
  AdminSetAttendanceConfirmationInput,
  AdminUserRole
} from '../../features/admin/adminManagementService.js'
import { AuthService } from '../../features/auth/authService.js'
import { ProfilePhotoService } from '../../features/profilePhoto/profilePhotoService.js'
import { RegistrationService } from '../../features/registrations/registrationService.js'
import { RuleService } from '../../features/rules/ruleService.js'
import { SessionService } from '../../features/sessions/sessionService.js'
import { SubSignupService } from '../../features/subs/subSignupService.js'
import { UserService } from '../../features/users/userService.js'
import type {
  LeagueMembershipStatus,
  LeagueStatus,
  RegistrationStatus,
  SessionOccurrenceStatus,
  SessionStatus,
  SubSignupStatus,
  Weekday
} from '../../generated/prisma/client.js'
import { resolveProfileImageUrl } from '../../integrations/cloudflare/profileImageUrl.js'
import type { AppContext } from '../context.js'
import {
  requireAuth,
  resolveEffectiveLeagueAccess,
  resolveEffectiveLeagueAccessForOrganization,
  resolveLeagueOrganizationId,
  requireLeagueAdminOrOwner,
  requireOccurrenceAdminOrOwner,
  requireOccurrenceLeagueAccess,
  requireOrgAdminOrOwner,
  resolveUserRoleForOrganization,
  resolveUserRoleWithoutContext,
  requireSessionAdminOrOwner,
  requireSlotAssignmentAdminOrOwner
} from '../auth.js'

const utcDateTimeErrorInvalid =
  'DateTime must be a UTC ISO-8601 value with a Z or +00:00 offset'

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

const utcDateTimeScalar: GraphQLScalarType =
  GraphQLDateTime as GraphQLScalarType

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

const userRolePlayer = 'PLAYER'
const userRoleAdmin = 'ADMIN'
const userRoleOwner = 'OWNER'
const roleContextOrganizationIdField = 'roleContextOrganizationId'
const roleContextLeagueIdField = 'roleContextLeagueId'
const organizationIdArgumentRequiredMessage =
  'organizationId must be a non-empty string'
const userMissingAfterVerificationMessage = 'User missing after verification'

type UserRole = 'PLAYER' | 'ADMIN' | 'OWNER'

type UserRoleContext = {
  roleContextOrganizationId?: string
  roleContextLeagueId?: string
}

type UserResolverParent = {
  id: string
  role?: string | null
  profileImageId?: string | null
  roleContextOrganizationId?: string | null
  roleContextLeagueId?: string | null
}

const normalizeLeagueIdArgument = (
  leagueId: string | null | undefined
): string | null => {
  if (typeof leagueId !== 'string') {
    return null
  }

  const trimmedLeagueId = leagueId.trim()
  return trimmedLeagueId.length > 0 ? trimmedLeagueId : null
}

const normalizeOrganizationIdArgument = (organizationId: string): string => {
  const trimmedOrganizationId = organizationId.trim()
  if (trimmedOrganizationId.length === 0) {
    throw new Error(organizationIdArgumentRequiredMessage)
  }

  return trimmedOrganizationId
}

const resolveMemberLeagueAccess = async (
  context: AppContext,
  organizationId: string,
  leagueId: string | null | undefined
) => {
  return resolveEffectiveLeagueAccessForOrganization(
    context,
    normalizeOrganizationIdArgument(organizationId),
    normalizeLeagueIdArgument(leagueId)
  )
}

const isUserRole = (value: unknown): value is UserRole => {
  return (
    value === userRolePlayer || value === userRoleAdmin || value === userRoleOwner
  )
}

const attachUserRoleContext = <T extends { id: string }>(
  user: T,
  roleContext: UserRoleContext
): T & UserRoleContext => {
  return {
    ...user,
    ...roleContext
  }
}

const resolveUserRole = async (
  user: UserResolverParent,
  context: AppContext
): Promise<UserRole> => {
  if (isUserRole(user.role)) {
    return user.role
  }

  const contextOrganizationId = user[roleContextOrganizationIdField]
  if (contextOrganizationId) {
    return resolveUserRoleForOrganization(context, user.id, contextOrganizationId)
  }

  const contextLeagueId = user[roleContextLeagueIdField]
  if (contextLeagueId) {
    const organizationId = await resolveLeagueOrganizationId(context, contextLeagueId)
    return resolveUserRoleForOrganization(context, user.id, organizationId)
  }

  if (context.request.userId && context.request.userId === user.id) {
    try {
      const effectiveLeagueAccess = await resolveEffectiveLeagueAccess(context, null)
      return resolveUserRoleForOrganization(
        context,
        user.id,
        effectiveLeagueAccess.organizationId
      )
    } catch {
      return resolveUserRoleWithoutContext(context, user.id)
    }
  }

  return resolveUserRoleWithoutContext(context, user.id)
}

const typeDefs = `#graphql
  scalar DateTime

  enum LeagueStatus {
    DRAFT
    UPCOMING
    ACTIVE
    ARCHIVED
  }

  enum LeagueMembershipStatus {
    ACTIVE
    REMOVED
  }

  enum UserRole {
    PLAYER
    ADMIN
    OWNER
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

  enum PlaySegmentSide {
    START
    END
  }

  enum RegistrationPlayMode {
    FULL
    PARTIAL
  }

  enum SubAvailabilityMode {
    FULL_ONLY
    FLEX
    PARTIAL_ONLY
  }

  enum SubSelectionType {
    FULL
    PARTIAL
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

  type Organization {
    id: ID!
    name: String!
    slug: String!
  }

  type User {
    id: ID!
    phoneNumber: String!
    displayName: String
    profileImageUrl: String
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
    registrationPlayMode: RegistrationPlayMode
    registrationPlaySegmentSide: PlaySegmentSide
    registrationPlayMinutes: Int
    registrationFillTargetRegistrationId: ID
    subSignupStatus: SubSignupStatus
    subAvailabilityMode: SubAvailabilityMode
    subAvailabilitySegmentSide: PlaySegmentSide
    subAvailabilityMinutes: Int
    subSelectionType: SubSelectionType
    subAssignedStartOffsetMinutes: Int
    subAssignedEndOffsetMinutes: Int
    subPartialLocked: Boolean!
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
    playMode: RegistrationPlayMode!
    playSegmentSide: PlaySegmentSide
    playMinutes: Int
    fillTargetRegistrationId: ID
  }

  type SubSignup {
    id: ID!
    status: SubSignupStatus!
    availabilityMode: SubAvailabilityMode!
    availabilitySegmentSide: PlaySegmentSide
    availabilityMinutes: Int
    selectionType: SubSelectionType
    assignedStartOffsetMinutes: Int
    assignedEndOffsetMinutes: Int
    partialLocked: Boolean!
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
    id: ID!
    user: User!
    status: String!
    selectionRank: Int
    selectionType: SubSelectionType
    startOffsetMinutes: Int
    endOffsetMinutes: Int
    partialLocked: Boolean
  }

  type SessionOccurrenceDetail {
    occurrenceId: ID!
    sessionDurationMinutes: Int!
    attendees: [SessionRosterEntry!]!
    subs: [SessionRosterEntry!]!
    openSpots: Int!
    registrationOpenAt: DateTime!
    registrationCloseAt: DateTime!
    canRegister: Boolean!
    canSub: Boolean!
    isRegistrationOpen: Boolean!
    isUserAssignedToSession: Boolean!
    myRegistrationPlayMode: RegistrationPlayMode
    myRegistrationPlaySegmentSide: PlaySegmentSide
    myRegistrationPlayMinutes: Int
    myRegistrationFillTargetRegistrationId: ID
    mySubAvailabilityMode: SubAvailabilityMode
    mySubAvailabilitySegmentSide: PlaySegmentSide
    mySubAvailabilityMinutes: Int
    mySubSelectionType: SubSelectionType
    mySubAssignedStartOffsetMinutes: Int
    mySubAssignedEndOffsetMinutes: Int
    mySubPartialLocked: Boolean!
  }

  type AuthPayload {
    token: String!
    user: User!
    eligibleOrganizations: [Organization!]!
  }

  type ProfilePhotoUploadIntent {
    imageId: ID!
    uploadUrl: String!
    expiresAt: DateTime!
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
    rules: [LeagueRule!]!
    sessions(input: AdminLeagueDetailInput): [AdminSessionTemplate!]!
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
    assignmentCount: Int!
    occurrenceCount: Int!
    assignments: [AdminSlotAssignment!]!
    occurrences(input: AdminLeagueDetailInput): [AdminSessionOccurrence!]!
  }

  type AdminSessionOccurrence {
    id: ID!
    sessionId: ID!
    startsAt: DateTime!
    endsAt: DateTime!
    status: SessionOccurrenceStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
    attendingCount: Int!
    subCount: Int!
    openSpots: Int!
  }

  type AdminSlotAssignment {
    id: ID!
    leagueId: ID!
    sessionId: ID!
    userId: ID!
    userPhoneNumber: String!
    userDisplayName: String
    isUserOnApp: Boolean!
    createdAt: DateTime!
  }

  type AdminLeagueMembership {
    id: ID!
    leagueId: ID!
    userId: ID!
    status: LeagueMembershipStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AdminLeaguesResult {
    items: [AdminLeague!]!
    totalCount: Int!
    limit: Int!
    offset: Int!
  }

  type AdminPlayersResult {
    items: [User!]!
    totalCount: Int!
    limit: Int!
    offset: Int!
  }

  type AdminOccurrenceRoster {
    occurrenceId: ID!
    sessionId: ID!
    occurrenceStatus: SessionOccurrenceStatus!
    startsAt: DateTime!
    endsAt: DateTime!
    openSpots: Int!
    confirmedCount: Int!
    unconfirmedCount: Int!
    attendanceConfirmations: [AdminAttendanceConfirmation!]!
    attendees: [SessionRosterEntry!]!
    subs: [SessionRosterEntry!]!
  }

  type AdminAttendanceConfirmation {
    userId: ID!
    isConfirmed: Boolean!
    confirmedAt: DateTime
    confirmedByUserId: ID
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
    organizationId: ID!
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

  input AdminCreatePlayerInput {
    leagueId: ID!
    phoneNumber: String!
    displayName: String
  }

  input AdminUpdatePlayerInput {
    organizationId: ID!
    phoneNumber: String
    displayName: String
    role: UserRole
  }

  input AdminSetLeagueMembershipInput {
    leagueId: ID!
    userId: ID!
    status: LeagueMembershipStatus!
  }

  input AdminSetAttendanceConfirmationInput {
    userId: ID!
    isConfirmed: Boolean!
  }

  input AdminPaginationInput {
    limit: Int
    offset: Int
  }

  input AdminLeagueDetailInput {
    includeArchivedSessions: Boolean = true
    includeCanceledOccurrences: Boolean = true
    occurrenceStart: DateTime
    occurrenceEnd: DateTime
    maxOccurrencesPerSession: Int = 250
  }

  input SetRegistrationPlayPreferenceInput {
    mode: RegistrationPlayMode!
    side: PlaySegmentSide
    minutes: Int
    fillTargetRegistrationId: ID
  }

  input SetSubAvailabilityPreferenceInput {
    availabilityMode: SubAvailabilityMode!
    side: PlaySegmentSide
    minutes: Int
  }

  type Query {
    me: User
    organizations: [Organization!]!
    playerOrganizations: [Organization!]!
    league(organizationId: ID!, leagueId: ID): League
    rules(organizationId: ID!, leagueId: ID): [LeagueRule!]!
    sessionsWeek(organizationId: ID!, leagueId: ID): [Session!]!
    sessionOccurrenceDetail(occurrenceId: ID!): SessionOccurrenceDetail!
    profileStats: ProfileStats!
    adminLeagues(organizationId: ID!, status: LeagueStatus, search: String, pagination: AdminPaginationInput): AdminLeaguesResult!
    adminLeagueDetail(leagueId: ID!): AdminLeague!
    adminLeagueRules(leagueId: ID!): [LeagueRule!]!
    adminPlayers(organizationId: ID!, search: String, isOnApp: Boolean, pagination: AdminPaginationInput): AdminPlayersResult!
    adminOccurrenceRoster(occurrenceId: ID!): AdminOccurrenceRoster!
  }

  type Mutation {
    requestPhoneVerification(phoneNumber: String!): Boolean!
    verifyPhoneCode(phoneNumber: String!, code: String!): AuthPayload!
    registerDevice(token: String!, platform: String!): Boolean!
    updateDisplayName(displayName: String!): User!
    completeOnboarding: User!
    createMyProfilePhotoUploadIntent: ProfilePhotoUploadIntent!
    completeMyProfilePhotoUpload(imageId: ID!): User!
    deleteMyProfilePhoto: User!
    deleteMyAccount: Boolean!

    registerForSession(occurrenceId: ID!): SessionRegistration!
    cancelRegistration(occurrenceId: ID!): SessionRegistration!
    setRegistrationPlayPreference(
      occurrenceId: ID!
      input: SetRegistrationPlayPreferenceInput!
    ): SessionRegistration!
    signupAsSub(occurrenceId: ID!): SubSignup!
    cancelSubSignup(occurrenceId: ID!): SubSignup!
    setSubAvailabilityPreference(
      occurrenceId: ID!
      input: SetSubAvailabilityPreferenceInput!
    ): SubSignup!
    setSubPartialLock(occurrenceId: ID!, isLocked: Boolean!): SubSignup!

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

    adminCreatePlayer(input: AdminCreatePlayerInput!): User!
    adminUpdatePlayer(playerId: ID!, input: AdminUpdatePlayerInput!): User!
    adminDeletePlayerProfilePhoto(organizationId: ID!, playerId: ID!): User!
    adminSetLeagueMembership(input: AdminSetLeagueMembershipInput!): AdminLeagueMembership!
    adminUpsertLeagueRule(leagueId: ID!, ruleId: ID, title: String!, body: String!, order: Int!): LeagueRule!
    adminCopyLeagueRulesFromTemplate(sourceLeagueId: ID!, targetLeagueId: ID!, replaceExisting: Boolean!): [LeagueRule!]!
    adminSetRegistration(occurrenceId: ID!, userId: ID!, status: RegistrationStatus!): SessionRegistration!
    adminSetSubSignup(occurrenceId: ID!, userId: ID!, status: SubSignupStatus!): SubSignup!
    adminSetAttendanceConfirmation(occurrenceId: ID!, userId: ID!, isConfirmed: Boolean!): AdminAttendanceConfirmation!
    adminSetAttendanceConfirmations(occurrenceId: ID!, inputs: [AdminSetAttendanceConfirmationInput!]!): [AdminAttendanceConfirmation!]!
  }
`

const resolvers = {
  DateTime: utcDateTimeScalar,
  User: {
    role: async (user: UserResolverParent, _: unknown, context: AppContext) => {
      return resolveUserRole(user, context)
    },
    profileImageUrl: (user: UserResolverParent) =>
      resolveProfileImageUrl(user.profileImageId)
  },
  Session: {
    registeredUsers: (session: { registeredUsers?: unknown[] | null }) =>
      session.registeredUsers ?? [],
    subUsers: (session: { subUsers?: unknown[] | null }) =>
      session.subUsers ?? []
  },
  AdminLeague: {
    rules: async (
      league: { id: string },
      _: unknown,
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, league.id)
      const adminService = new AdminManagementService()
      return adminService.adminLeagueRules(league.id)
    },
    sessions: async (
      league: { id: string },
      args: { input?: AdminLeagueDetailInput | null },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, league.id)
      const adminService = new AdminManagementService()
      return adminService.adminLeagueDetailSessions(league.id, args.input)
    }
  },
  AdminSessionTemplate: {
    assignmentCount: async (
      session: Partial<AdminLeagueDetailSession> & { id: string },
      _: unknown,
      context: AppContext
    ) => {
      await requireSessionAdminOrOwner(context, session.id)
      if (typeof session.assignmentCount === 'number') {
        return session.assignmentCount
      }

      if (Array.isArray(session.assignments)) {
        return session.assignments.length
      }

      const adminService = new AdminManagementService()
      return adminService.adminSessionTemplateAssignmentCount(session.id)
    },
    occurrenceCount: async (
      session: Partial<AdminLeagueDetailSession> & { id: string },
      _: unknown,
      context: AppContext
    ) => {
      await requireSessionAdminOrOwner(context, session.id)
      if (typeof session.occurrenceCount === 'number') {
        return session.occurrenceCount
      }

      const adminService = new AdminManagementService()
      return adminService.adminSessionTemplateOccurrenceCount(session.id, null)
    },
    assignments: async (
      session: Partial<AdminLeagueDetailSession> & { id: string },
      _: unknown,
      context: AppContext
    ) => {
      await requireSessionAdminOrOwner(context, session.id)
      if (Array.isArray(session.assignments)) {
        return session.assignments
      }

      const adminService = new AdminManagementService()
      return adminService.adminSessionTemplateAssignments(session.id)
    },
    occurrences: async (
      session: Partial<AdminLeagueDetailSession> & {
        id: string
        capacity: number
      },
      args: { input?: AdminLeagueDetailInput | null },
      context: AppContext
    ) => {
      await requireSessionAdminOrOwner(context, session.id)
      const adminService = new AdminManagementService()
      if (Array.isArray(session.occurrences)) {
        if (!args.input) {
          return session.occurrences
        }

        const inputKey = adminService.getAdminLeagueDetailInputCacheKey(
          args.input
        )
        if (session.adminLeagueDetailInputKey === inputKey) {
          return session.occurrences
        }
      }

      return adminService.adminSessionTemplateOccurrences(
        session.id,
        session.capacity,
        args.input
      )
    }
  },
  AdminSlotAssignment: {
    userPhoneNumber: (assignment: { user: { phoneNumber: string } }) =>
      assignment.user.phoneNumber,
    userDisplayName: (assignment: { user: { displayName: string | null } }) =>
      assignment.user.displayName,
    isUserOnApp: (assignment: { user: { isOnApp: boolean } }) =>
      assignment.user.isOnApp
  },
  Query: {
    me: async (_: unknown, __: unknown, context: AppContext) => {
      if (!context.request.userId) {
        return null
      }

      const user = await context.prisma.user.findUnique({
        where: { id: context.request.userId }
      })
      if (!user) {
        return null
      }

      try {
        const leagueAccess = await resolveEffectiveLeagueAccess(context, null)
        return attachUserRoleContext(user, {
          [roleContextLeagueIdField]: leagueAccess.leagueId
        })
      } catch {
        return user
      }
    },
    organizations: async (_: unknown, __: unknown, context: AppContext) => {
      const userId = requireAuth(context)
      const userService = new UserService()
      return userService.listOrganizations(userId)
    },
    playerOrganizations: async (_: unknown, __: unknown, context: AppContext) => {
      const userId = requireAuth(context)
      const userService = new UserService()
      return userService.listPlayerOrganizations(userId)
    },
    league: async (
      _: unknown,
      args: { organizationId: string; leagueId?: string | null },
      context: AppContext
    ) => {
      const leagueAccess = await resolveMemberLeagueAccess(
        context,
        args.organizationId,
        args.leagueId
      )
      return context.prisma.league.findUnique({
        where: { id: leagueAccess.leagueId }
      })
    },
    rules: async (
      _: unknown,
      args: { organizationId: string; leagueId?: string | null },
      context: AppContext
    ) => {
      const leagueAccess = await resolveMemberLeagueAccess(
        context,
        args.organizationId,
        args.leagueId
      )
      const ruleService = new RuleService()
      return ruleService.listRules(leagueAccess.leagueId)
    },
    sessionsWeek: async (
      _: unknown,
      args: { organizationId: string; leagueId?: string | null },
      context: AppContext
    ) => {
      const leagueAccess = await resolveMemberLeagueAccess(
        context,
        args.organizationId,
        args.leagueId
      )
      const sessionService = new SessionService()
      return sessionService.listSessionsWeek(
        leagueAccess.leagueId,
        context.request.userId
      )
    },
    sessionOccurrenceDetail: async (
      _: unknown,
      args: { occurrenceId: string },
      context: AppContext
    ) => {
      await requireOccurrenceLeagueAccess(context, args.occurrenceId)
      const sessionService = new SessionService()
      return sessionService.getOccurrenceDetail(
        args.occurrenceId,
        context.request.userId
      )
    },
    profileStats: async (_: unknown, __: unknown, context: AppContext) => {
      const userId = requireAuth(context)
      const userService = new UserService()
      return userService.getProfileStats(userId)
    },
    adminLeagues: async (
      _: unknown,
      args: {
        organizationId: string
        status?: LeagueStatus
        search?: string
        pagination?: {
          limit?: number | null
          offset?: number | null
        } | null
      },
      context: AppContext
    ) => {
      await requireOrgAdminOrOwner(context, args.organizationId)
      const adminService = new AdminManagementService()
      return adminService.adminLeagues({
        organizationId: args.organizationId,
        status: args.status,
        search: args.search,
        pagination: args.pagination
      })
    },
    adminLeagueDetail: async (
      _: unknown,
      args: { leagueId: string },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, args.leagueId)
      const adminService = new AdminManagementService()
      return adminService.adminLeagueDetail(args.leagueId)
    },
    adminLeagueRules: async (
      _: unknown,
      args: { leagueId: string },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, args.leagueId)
      const adminService = new AdminManagementService()
      return adminService.adminLeagueRules(args.leagueId)
    },
    adminPlayers: async (
      _: unknown,
      args: {
        organizationId: string
        search?: string
        isOnApp?: boolean
        pagination?: {
          limit?: number | null
          offset?: number | null
        } | null
      },
      context: AppContext
    ) => {
      await requireOrgAdminOrOwner(context, args.organizationId)
      const adminService = new AdminManagementService()
      const result = await adminService.adminPlayers({
        organizationId: args.organizationId,
        search: args.search,
        isOnApp: args.isOnApp,
        pagination: args.pagination
      })
      return {
        ...result,
        items: result.items.map((item) =>
          attachUserRoleContext(item, {
            [roleContextOrganizationIdField]: args.organizationId
          })
        )
      }
    },
    adminOccurrenceRoster: async (
      _: unknown,
      args: { occurrenceId: string },
      context: AppContext
    ) => {
      await requireOccurrenceAdminOrOwner(context, args.occurrenceId)
      const adminService = new AdminManagementService()
      return adminService.adminOccurrenceRoster(args.occurrenceId)
    }
  },
  Mutation: {
    requestPhoneVerification: async (
      _: unknown,
      args: { phoneNumber: string }
    ) => {
      const authService = new AuthService()
      await authService.requestPhoneVerification(args.phoneNumber)
      return true
    },
    verifyPhoneCode: async (
      _: unknown,
      args: { phoneNumber: string; code: string },
      context: AppContext
    ) => {
      const authService = new AuthService()
      const result = await authService.verifyPhoneCode(
        args.phoneNumber,
        args.code
      )
      const user = await context.prisma.user.findUnique({
        where: { id: result.userId }
      })

      if (!user) {
        throw new Error(userMissingAfterVerificationMessage)
      }

      const userService = new UserService()
      const eligibleOrganizations = await userService.listPlayerOrganizations(
        result.userId
      )

      return {
        token: result.token,
        user,
        eligibleOrganizations
      }
    },
    registerDevice: async (
      _: unknown,
      args: { token: string; platform: string },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      await context.prisma.userDevice.upsert({
        where: { token: args.token },
        create: { token: args.token, platform: args.platform, userId },
        update: { platform: args.platform, userId }
      })
      return true
    },
    updateDisplayName: async (
      _: unknown,
      args: { displayName: string },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new UserService()
      return service.upsertDisplayName(userId, args.displayName)
    },
    completeOnboarding: async (_: unknown, __: unknown, context: AppContext) => {
      const userId = requireAuth(context)
      const service = new UserService()
      return service.completeOnboarding(userId)
    },
    createMyProfilePhotoUploadIntent: async (
      _: unknown,
      __: unknown,
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const profilePhotoService = new ProfilePhotoService()
      const uploadIntent = await profilePhotoService.createUploadIntent(userId)
      return {
        imageId: uploadIntent.imageId,
        uploadUrl: uploadIntent.uploadUrl,
        expiresAt: uploadIntent.expiresAt
      }
    },
    completeMyProfilePhotoUpload: async (
      _: unknown,
      args: { imageId: string },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const profilePhotoService = new ProfilePhotoService()
      return profilePhotoService.completeUpload(userId, args.imageId)
    },
    deleteMyProfilePhoto: async (
      _: unknown,
      __: unknown,
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const profilePhotoService = new ProfilePhotoService()
      return profilePhotoService.deleteMyProfilePhoto(userId)
    },
    deleteMyAccount: async (
      _: unknown,
      __: unknown,
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new UserService()
      await service.deleteMyAccount(userId)
      return true
    },
    registerForSession: async (
      _: unknown,
      args: { occurrenceId: string },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new RegistrationService()
      return service.register(userId, args.occurrenceId)
    },
    cancelRegistration: async (
      _: unknown,
      args: { occurrenceId: string },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new RegistrationService()
      return service.cancel(userId, args.occurrenceId)
    },
    setRegistrationPlayPreference: async (
      _: unknown,
      args: {
        occurrenceId: string
        input: {
          mode: 'FULL' | 'PARTIAL'
          side?: 'START' | 'END' | null
          minutes?: number | null
          fillTargetRegistrationId?: string | null
        }
      },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new RegistrationService()
      return service.setPlayPreference(userId, args.occurrenceId, {
        mode: args.input.mode,
        side: args.input.side ?? null,
        minutes: args.input.minutes ?? null,
        fillTargetRegistrationId: args.input.fillTargetRegistrationId ?? null
      })
    },
    signupAsSub: async (
      _: unknown,
      args: { occurrenceId: string },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new SubSignupService()
      return service.signup(userId, args.occurrenceId)
    },
    cancelSubSignup: async (
      _: unknown,
      args: { occurrenceId: string },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new SubSignupService()
      return service.cancel(userId, args.occurrenceId)
    },
    setSubAvailabilityPreference: async (
      _: unknown,
      args: {
        occurrenceId: string
        input: {
          availabilityMode: 'FULL_ONLY' | 'FLEX' | 'PARTIAL_ONLY'
          side?: 'START' | 'END' | null
          minutes?: number | null
        }
      },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new SubSignupService()
      return service.setAvailabilityPreference(userId, args.occurrenceId, {
        availabilityMode: args.input.availabilityMode,
        side: args.input.side ?? null,
        minutes: args.input.minutes ?? null
      })
    },
    setSubPartialLock: async (
      _: unknown,
      args: { occurrenceId: string; isLocked: boolean },
      context: AppContext
    ) => {
      const userId = requireAuth(context)
      const service = new SubSignupService()
      return service.setPartialLock(userId, args.occurrenceId, args.isLocked)
    },
    adminCreateLeague: async (
      _: unknown,
      args: {
        input: {
          organizationId: string
          name: string
          status?: LeagueStatus
          startDate?: Date | null
          endDate?: Date | null
          timeZone?: string | null
        }
      },
      context: AppContext
    ) => {
      await requireOrgAdminOrOwner(context, args.input.organizationId)
      const adminService = new AdminManagementService()
      return adminService.createLeague(args.input)
    },
    adminUpdateLeague: async (
      _: unknown,
      args: {
        leagueId: string
        input: {
          name?: string
          status?: LeagueStatus
          startDate?: Date | null
          endDate?: Date | null
          timeZone?: string | null
        }
      },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, args.leagueId)
      const adminService = new AdminManagementService()
      return adminService.updateLeague(args.leagueId, args.input)
    },
    adminDeleteLeague: async (
      _: unknown,
      args: { leagueId: string },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, args.leagueId)
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
      await requireLeagueAdminOrOwner(context, args.input.leagueId)
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
      await requireSessionAdminOrOwner(context, args.sessionId)
      const adminService = new AdminManagementService()
      return adminService.updateSession(args.sessionId, args.input)
    },
    adminDeleteSession: async (
      _: unknown,
      args: { sessionId: string },
      context: AppContext
    ) => {
      await requireSessionAdminOrOwner(context, args.sessionId)
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
      await requireSessionAdminOrOwner(context, args.input.sessionId)
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
      const sessionIds = Array.from(new Set(args.inputs.map((input) => input.sessionId)))
      await Promise.all(sessionIds.map((sessionId) => requireSessionAdminOrOwner(context, sessionId)))
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
      await requireOccurrenceAdminOrOwner(context, args.occurrenceId)
      const adminService = new AdminManagementService()
      return adminService.updateSessionOccurrence(args.occurrenceId, args.input)
    },
    adminDeleteSessionOccurrence: async (
      _: unknown,
      args: { occurrenceId: string },
      context: AppContext
    ) => {
      await requireOccurrenceAdminOrOwner(context, args.occurrenceId)
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
      await requireLeagueAdminOrOwner(context, args.input.leagueId)
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
      const leagueIds = Array.from(new Set(args.inputs.map((input) => input.leagueId)))
      await Promise.all(leagueIds.map((leagueId) => requireLeagueAdminOrOwner(context, leagueId)))
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
      await requireSlotAssignmentAdminOrOwner(context, args.slotAssignmentId)
      const adminService = new AdminManagementService()
      return adminService.updateSlotAssignment(
        args.slotAssignmentId,
        args.input
      )
    },
    adminDeleteSlotAssignment: async (
      _: unknown,
      args: { slotAssignmentId: string },
      context: AppContext
    ) => {
      await requireSlotAssignmentAdminOrOwner(context, args.slotAssignmentId)
      const adminService = new AdminManagementService()
      return adminService.deleteSlotAssignment(args.slotAssignmentId)
    },
    adminCreatePlayer: async (
      _: unknown,
      args: {
        input: {
          leagueId: string
          phoneNumber: string
          displayName?: string | null
        }
      },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, args.input.leagueId)
      const adminService = new AdminManagementService()
      const user = await adminService.adminCreatePlayer({
        leagueId: args.input.leagueId,
        phoneNumber: args.input.phoneNumber,
        displayName: args.input.displayName
      })
      return attachUserRoleContext(user, {
        [roleContextLeagueIdField]: args.input.leagueId
      })
    },
    adminUpdatePlayer: async (
      _: unknown,
      args: {
        playerId: string
        input: {
          organizationId: string
          phoneNumber?: string | null
          displayName?: string | null
          role?: AdminUserRole | null
        }
      },
      context: AppContext
    ) => {
      await requireOrgAdminOrOwner(context, args.input.organizationId)
      const adminService = new AdminManagementService()
      const user = await adminService.adminUpdatePlayer(args.playerId, {
        organizationId: args.input.organizationId,
        phoneNumber: args.input.phoneNumber,
        displayName: args.input.displayName,
        role: args.input.role
      })
      return attachUserRoleContext(user, {
        [roleContextOrganizationIdField]: args.input.organizationId
      })
    },
    adminDeletePlayerProfilePhoto: async (
      _: unknown,
      args: { organizationId: string; playerId: string },
      context: AppContext
    ) => {
      await requireOrgAdminOrOwner(context, args.organizationId)
      const profilePhotoService = new ProfilePhotoService()
      const user = await profilePhotoService.adminDeletePlayerProfilePhoto(
        args.organizationId,
        args.playerId
      )
      return attachUserRoleContext(user, {
        [roleContextOrganizationIdField]: args.organizationId
      })
    },
    adminSetLeagueMembership: async (
      _: unknown,
      args: {
        input: {
          leagueId: string
          userId: string
          status: LeagueMembershipStatus
        }
      },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, args.input.leagueId)
      const adminService = new AdminManagementService()
      return adminService.adminSetLeagueMembership(args.input)
    },
    adminUpsertLeagueRule: async (
      _: unknown,
      args: {
        leagueId: string
        ruleId?: string | null
        title: string
        body: string
        order: number
      },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, args.leagueId)
      const adminService = new AdminManagementService()
      return adminService.adminUpsertLeagueRule(
        args.leagueId,
        args.ruleId,
        args.title,
        args.body,
        args.order
      )
    },
    adminCopyLeagueRulesFromTemplate: async (
      _: unknown,
      args: {
        sourceLeagueId: string
        targetLeagueId: string
        replaceExisting: boolean
      },
      context: AppContext
    ) => {
      await requireLeagueAdminOrOwner(context, args.sourceLeagueId)
      await requireLeagueAdminOrOwner(context, args.targetLeagueId)
      const adminService = new AdminManagementService()
      return adminService.adminCopyLeagueRulesFromTemplate(
        args.sourceLeagueId,
        args.targetLeagueId,
        args.replaceExisting
      )
    },
    adminSetRegistration: async (
      _: unknown,
      args: {
        occurrenceId: string
        userId: string
        status: RegistrationStatus
      },
      context: AppContext
    ) => {
      await requireOccurrenceAdminOrOwner(context, args.occurrenceId)
      const adminService = new AdminManagementService()
      return adminService.adminSetRegistration(
        args.occurrenceId,
        args.userId,
        args.status
      )
    },
    adminSetSubSignup: async (
      _: unknown,
      args: {
        occurrenceId: string
        userId: string
        status: SubSignupStatus
      },
      context: AppContext
    ) => {
      await requireOccurrenceAdminOrOwner(context, args.occurrenceId)
      const adminService = new AdminManagementService()
      return adminService.adminSetSubSignup(
        args.occurrenceId,
        args.userId,
        args.status
      )
    },
    adminSetAttendanceConfirmation: async (
      _: unknown,
      args: {
        occurrenceId: string
        userId: string
        isConfirmed: boolean
      },
      context: AppContext
    ) => {
      const actorUserId = await requireOccurrenceAdminOrOwner(
        context,
        args.occurrenceId
      )
      const adminService = new AdminManagementService()
      return adminService.adminSetAttendanceConfirmation(
        args.occurrenceId,
        args.userId,
        args.isConfirmed,
        actorUserId
      )
    },
    adminSetAttendanceConfirmations: async (
      _: unknown,
      args: {
        occurrenceId: string
        inputs: AdminSetAttendanceConfirmationInput[]
      },
      context: AppContext
    ) => {
      const actorUserId = await requireOccurrenceAdminOrOwner(
        context,
        args.occurrenceId
      )
      const adminService = new AdminManagementService()
      return adminService.adminSetAttendanceConfirmations(
        args.occurrenceId,
        args.inputs,
        actorUserId
      )
    }
  }
}

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers
})
