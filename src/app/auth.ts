import jwt from 'jsonwebtoken'

import type { OrganizationMembershipRole } from '../generated/prisma/client.js'

import type { AppContext } from './context.js'

type TokenPayload = {
  userId: string
}

const authTokenMissingMessage = 'Missing auth token'
const userMissingMessage = 'User missing'
const adminRequiredMessage = 'Organization admin role required'
const leagueMissingMessage = 'League missing'
const sessionMissingMessage = 'Session missing'
const occurrenceMissingMessage = 'Session occurrence missing'
const slotAssignmentMissingMessage = 'Slot assignment missing'
const leagueRuleMissingMessage = 'League rule missing'
const leagueAccessRequiredMessage = 'League access required'
const leagueMembershipStatusActive = 'ACTIVE'
const orgRolesWithAdminAccess: OrganizationMembershipRole[] = ['OWNER', 'ADMIN']

export const requireAuth = (context: AppContext): string => {
  const token = context.request.authToken

  if (!token) {
    throw new Error(authTokenMissingMessage)
  }

  const payload = jwt.verify(token, context.config.auth.jwtSecret) as TokenPayload

  return payload.userId
}

const requireExistingUser = async (context: AppContext, userId: string): Promise<void> => {
  const user = await context.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }
  })

  if (!user) {
    throw new Error(userMissingMessage)
  }
}

export const requireOrgAdminOrOwner = async (
  context: AppContext,
  organizationId: string
): Promise<string> => {
  const userId = requireAuth(context)
  await requireExistingUser(context, userId)

  const membership = await context.prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId
      }
    },
    select: {
      role: true
    }
  })

  if (!membership || !orgRolesWithAdminAccess.includes(membership.role)) {
    throw new Error(adminRequiredMessage)
  }

  return userId
}

const resolveLeagueOrganizationId = async (context: AppContext, leagueId: string): Promise<string> => {
  const league = await context.prisma.league.findUnique({
    where: { id: leagueId },
    select: { organizationId: true }
  })

  if (!league) {
    throw new Error(leagueMissingMessage)
  }

  return league.organizationId
}

export const requireLeagueAdminOrOwner = async (
  context: AppContext,
  leagueId: string
): Promise<string> => {
  const organizationId = await resolveLeagueOrganizationId(context, leagueId)
  return requireOrgAdminOrOwner(context, organizationId)
}

export const requireSessionAdminOrOwner = async (
  context: AppContext,
  sessionId: string
): Promise<string> => {
  const session = await context.prisma.session.findUnique({
    where: { id: sessionId },
    select: { leagueId: true }
  })

  if (!session) {
    throw new Error(sessionMissingMessage)
  }

  return requireLeagueAdminOrOwner(context, session.leagueId)
}

export const requireOccurrenceAdminOrOwner = async (
  context: AppContext,
  occurrenceId: string
): Promise<string> => {
  const occurrence = await context.prisma.sessionOccurrence.findUnique({
    where: { id: occurrenceId },
    select: { session: { select: { leagueId: true } } }
  })

  if (!occurrence) {
    throw new Error(occurrenceMissingMessage)
  }

  return requireLeagueAdminOrOwner(context, occurrence.session.leagueId)
}

export const requireSlotAssignmentAdminOrOwner = async (
  context: AppContext,
  slotAssignmentId: string
): Promise<string> => {
  const assignment = await context.prisma.slotAssignment.findUnique({
    where: { id: slotAssignmentId },
    select: { leagueId: true }
  })

  if (!assignment) {
    throw new Error(slotAssignmentMissingMessage)
  }

  return requireLeagueAdminOrOwner(context, assignment.leagueId)
}

export const requireLeagueRuleAdminOrOwner = async (
  context: AppContext,
  ruleId: string
): Promise<string> => {
  const rule = await context.prisma.leagueRule.findUnique({
    where: { id: ruleId },
    select: { leagueId: true }
  })

  if (!rule) {
    throw new Error(leagueRuleMissingMessage)
  }

  return requireLeagueAdminOrOwner(context, rule.leagueId)
}

export const requireLeagueAccess = async (
  context: AppContext,
  leagueId: string
): Promise<string> => {
  const userId = requireAuth(context)
  await requireExistingUser(context, userId)

  const league = await context.prisma.league.findUnique({
    where: { id: leagueId },
    select: { organizationId: true }
  })

  if (!league) {
    throw new Error(leagueMissingMessage)
  }

  const [orgMembership, leagueMembership] = await Promise.all([
    context.prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: league.organizationId,
          userId
        }
      },
      select: { role: true }
    }),
    context.prisma.leagueMembership.findUnique({
      where: {
        leagueId_userId: {
          leagueId,
          userId
        }
      },
      select: { status: true }
    })
  ])

  const hasOrgAdminAccess = Boolean(orgMembership && orgRolesWithAdminAccess.includes(orgMembership.role))
  const hasLeagueMembership = leagueMembership?.status === leagueMembershipStatusActive

  if (!hasOrgAdminAccess && !hasLeagueMembership) {
    throw new Error(leagueAccessRequiredMessage)
  }

  return userId
}

export const requireOccurrenceLeagueAccess = async (
  context: AppContext,
  occurrenceId: string
): Promise<string> => {
  const occurrence = await context.prisma.sessionOccurrence.findUnique({
    where: { id: occurrenceId },
    select: {
      session: {
        select: {
          leagueId: true
        }
      }
    }
  })

  if (!occurrence) {
    throw new Error(occurrenceMissingMessage)
  }

  return requireLeagueAccess(context, occurrence.session.leagueId)
}
