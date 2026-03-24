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
const leagueAccessRequiredMessage = 'League access required'
const leagueOrganizationMismatchMessage = 'League does not belong to organization'
const leagueMembershipStatusActive = 'ACTIVE'
const leagueStatusActive = 'ACTIVE'
const multipleActiveLeaguesMessage = 'Multiple active leagues found; provide leagueId'
const orgRolesWithAdminAccess: OrganizationMembershipRole[] = ['OWNER', 'ADMIN']
const userRolePlayer = 'PLAYER'
const userRoleAdmin = 'ADMIN'
const userRoleOwner = 'OWNER'

type LeagueAccessCandidate = {
  leagueId: string
  organizationId: string
}

export type UserRole = 'PLAYER' | 'ADMIN' | 'OWNER'

export const requireAuth = (context: AppContext): string => {
  if (context.request.userId) {
    return context.request.userId
  }

  const token = context.request.authToken

  if (!token) {
    throw new Error(authTokenMissingMessage)
  }

  const payload = jwt.verify(token, context.config.auth.jwtSecret) as TokenPayload
  context.request.userId = payload.userId

  return payload.userId
}

const requireExistingUser = async (context: AppContext, userId: string): Promise<void> => {
  if (context.request.authzCache.hasVerifiedUser) {
    return
  }

  const user = await context.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }
  })

  if (!user) {
    throw new Error(userMissingMessage)
  }

  context.request.authzCache.hasVerifiedUser = true
}

const hasOrgAdminOrOwnerAccess = async (
  context: AppContext,
  userId: string,
  organizationId: string
): Promise<boolean> => {
  const cachedResult = context.request.authzCache.orgAdminByOrgId.get(organizationId)
  if (cachedResult !== undefined) {
    return cachedResult
  }

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

  const hasAccess = Boolean(membership && orgRolesWithAdminAccess.includes(membership.role))
  context.request.authzCache.orgAdminByOrgId.set(organizationId, hasAccess)
  return hasAccess
}

export const resolveLeagueOrganizationId = async (
  context: AppContext,
  leagueId: string
): Promise<string> => {
  const cachedOrganizationId = context.request.authzCache.orgIdByLeagueId.get(leagueId)
  if (cachedOrganizationId) {
    return cachedOrganizationId
  }

  const league = await context.prisma.league.findUnique({
    where: { id: leagueId },
    select: { organizationId: true }
  })

  if (!league) {
    throw new Error(leagueMissingMessage)
  }

  context.request.authzCache.orgIdByLeagueId.set(leagueId, league.organizationId)
  return league.organizationId
}

const dedupeLeagueCandidates = (
  candidates: LeagueAccessCandidate[]
): LeagueAccessCandidate[] => {
  const candidatesByLeagueId = new Map<string, LeagueAccessCandidate>()
  candidates.forEach((candidate) => {
    if (!candidatesByLeagueId.has(candidate.leagueId)) {
      candidatesByLeagueId.set(candidate.leagueId, candidate)
    }
  })
  return Array.from(candidatesByLeagueId.values())
}

const resolveLeagueCandidatesFromActiveMemberships = async (
  context: AppContext,
  userId: string
): Promise<LeagueAccessCandidate[]> => {
  const memberships = await context.prisma.leagueMembership.findMany({
    where: {
      userId,
      status: leagueMembershipStatusActive,
      league: { status: leagueStatusActive }
    },
    select: {
      leagueId: true,
      league: {
        select: {
          organizationId: true
        }
      }
    }
  })

  return memberships.map((membership) => ({
    leagueId: membership.leagueId,
    organizationId: membership.league.organizationId
  }))
}

const resolveLeagueCandidatesFromOrgAdminMemberships = async (
  context: AppContext,
  userId: string
): Promise<LeagueAccessCandidate[]> => {
  const memberships = await context.prisma.organizationMembership.findMany({
    where: {
      userId,
      role: { in: orgRolesWithAdminAccess }
    },
    select: {
      organizationId: true,
      organization: {
        select: {
          leagues: {
            where: { status: leagueStatusActive },
            select: {
              id: true,
              organizationId: true
            }
          }
        }
      }
    }
  })

  return memberships.flatMap((membership) =>
    membership.organization.leagues.map((league) => ({
      leagueId: league.id,
      organizationId: league.organizationId
    }))
  )
}

export const resolveEffectiveLeagueAccess = async (
  context: AppContext,
  leagueId: string | null | undefined
): Promise<{ userId: string; leagueId: string; organizationId: string }> => {
  const userId = requireAuth(context)
  await requireExistingUser(context, userId)

  if (leagueId) {
    await requireLeagueAccess(context, leagueId)
    const organizationId = await resolveLeagueOrganizationId(context, leagueId)
    return { userId, leagueId, organizationId }
  }

  const activeLeagueMembershipCandidates =
    await resolveLeagueCandidatesFromActiveMemberships(context, userId)
  let candidates = dedupeLeagueCandidates(activeLeagueMembershipCandidates)

  if (candidates.length === 0) {
    const orgAdminCandidates = await resolveLeagueCandidatesFromOrgAdminMemberships(
      context,
      userId
    )
    candidates = dedupeLeagueCandidates(orgAdminCandidates)
  }

  if (candidates.length === 0) {
    throw new Error(leagueAccessRequiredMessage)
  }

  if (candidates.length > 1) {
    throw new Error(multipleActiveLeaguesMessage)
  }

  const [candidate] = candidates
  context.request.authzCache.leagueAccessByLeagueId.set(candidate.leagueId, true)
  context.request.authzCache.orgIdByLeagueId.set(
    candidate.leagueId,
    candidate.organizationId
  )
  return {
    userId,
    leagueId: candidate.leagueId,
    organizationId: candidate.organizationId
  }
}

/**
 * Resolves member league access within a required organization context.
 * - Uses explicit league when provided and enforces org match.
 * - Otherwise resolves the organization's active league.
 * - Enforces standard league access checks in both flows.
 */
export const resolveEffectiveLeagueAccessForOrganization = async (
  context: AppContext,
  organizationId: string,
  leagueId: string | null | undefined
): Promise<{ userId: string; leagueId: string; organizationId: string }> => {
  const userId = requireAuth(context)
  await requireExistingUser(context, userId)

  if (leagueId) {
    await requireLeagueAccess(context, leagueId)
    const resolvedOrganizationId = await resolveLeagueOrganizationId(context, leagueId)
    if (resolvedOrganizationId !== organizationId) {
      throw new Error(leagueOrganizationMismatchMessage)
    }

    return { userId, leagueId, organizationId }
  }

  const activeLeague = await context.prisma.league.findFirst({
    where: {
      organizationId,
      status: leagueStatusActive
    },
    select: {
      id: true
    }
  })

  if (!activeLeague) {
    throw new Error(leagueAccessRequiredMessage)
  }

  context.request.authzCache.orgIdByLeagueId.set(activeLeague.id, organizationId)
  await requireLeagueAccess(context, activeLeague.id)
  return {
    userId,
    leagueId: activeLeague.id,
    organizationId
  }
}

const mapOrgMembershipRoleToUserRole = (
  role: OrganizationMembershipRole | null
): UserRole => {
  if (role === userRoleOwner) {
    return userRoleOwner
  }

  if (role === userRoleAdmin) {
    return userRoleAdmin
  }

  return userRolePlayer
}

export const resolveUserRoleForOrganization = async (
  context: AppContext,
  userId: string,
  organizationId: string
): Promise<UserRole> => {
  const cacheKey = `${organizationId}:${userId}`
  const cachedRole = context.request.authzCache.userRoleByOrgAndUser.get(cacheKey)
  if (cachedRole) {
    return cachedRole
  }

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

  const resolvedRole = mapOrgMembershipRoleToUserRole(membership?.role ?? null)
  context.request.authzCache.userRoleByOrgAndUser.set(cacheKey, resolvedRole)
  return resolvedRole
}

export const resolveUserRoleWithoutContext = async (
  context: AppContext,
  userId: string
): Promise<UserRole> => {
  const memberships = await context.prisma.organizationMembership.findMany({
    where: { userId },
    select: { role: true }
  })

  if (memberships.some((membership) => membership.role === userRoleOwner)) {
    return userRoleOwner
  }

  if (memberships.some((membership) => membership.role === userRoleAdmin)) {
    return userRoleAdmin
  }

  return userRolePlayer
}

const resolveSessionLeagueId = async (context: AppContext, sessionId: string): Promise<string> => {
  const cachedLeagueId = context.request.authzCache.leagueIdBySessionId.get(sessionId)
  if (cachedLeagueId) {
    return cachedLeagueId
  }

  const session = await context.prisma.session.findUnique({
    where: { id: sessionId },
    select: { leagueId: true }
  })

  if (!session) {
    throw new Error(sessionMissingMessage)
  }

  context.request.authzCache.leagueIdBySessionId.set(sessionId, session.leagueId)
  return session.leagueId
}

const resolveOccurrenceLeagueId = async (
  context: AppContext,
  occurrenceId: string
): Promise<string> => {
  const cachedLeagueId = context.request.authzCache.leagueIdByOccurrenceId.get(occurrenceId)
  if (cachedLeagueId) {
    return cachedLeagueId
  }

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

  const leagueId = occurrence.session.leagueId
  context.request.authzCache.leagueIdByOccurrenceId.set(occurrenceId, leagueId)
  return leagueId
}

const resolveSlotAssignmentLeagueId = async (
  context: AppContext,
  slotAssignmentId: string
): Promise<string> => {
  const cachedLeagueId = context.request.authzCache.leagueIdBySlotAssignmentId.get(slotAssignmentId)
  if (cachedLeagueId) {
    return cachedLeagueId
  }

  const assignment = await context.prisma.slotAssignment.findUnique({
    where: { id: slotAssignmentId },
    select: { leagueId: true }
  })

  if (!assignment) {
    throw new Error(slotAssignmentMissingMessage)
  }

  context.request.authzCache.leagueIdBySlotAssignmentId.set(slotAssignmentId, assignment.leagueId)
  return assignment.leagueId
}

export const requireOrgAdminOrOwner = async (
  context: AppContext,
  organizationId: string
): Promise<string> => {
  const userId = requireAuth(context)
  await requireExistingUser(context, userId)

  const hasAccess = await hasOrgAdminOrOwnerAccess(context, userId, organizationId)
  if (!hasAccess) {
    throw new Error(adminRequiredMessage)
  }

  return userId
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
  const leagueId = await resolveSessionLeagueId(context, sessionId)
  return requireLeagueAdminOrOwner(context, leagueId)
}

export const requireOccurrenceAdminOrOwner = async (
  context: AppContext,
  occurrenceId: string
): Promise<string> => {
  const leagueId = await resolveOccurrenceLeagueId(context, occurrenceId)
  return requireLeagueAdminOrOwner(context, leagueId)
}

export const requireSlotAssignmentAdminOrOwner = async (
  context: AppContext,
  slotAssignmentId: string
): Promise<string> => {
  const leagueId = await resolveSlotAssignmentLeagueId(context, slotAssignmentId)
  return requireLeagueAdminOrOwner(context, leagueId)
}

export const requireLeagueAccess = async (
  context: AppContext,
  leagueId: string
): Promise<string> => {
  const userId = requireAuth(context)
  await requireExistingUser(context, userId)

  const cachedResult = context.request.authzCache.leagueAccessByLeagueId.get(leagueId)
  if (cachedResult !== undefined) {
    if (!cachedResult) {
      throw new Error(leagueAccessRequiredMessage)
    }

    return userId
  }

  const organizationId = await resolveLeagueOrganizationId(context, leagueId)
  const hasOrgAdminAccess = await hasOrgAdminOrOwnerAccess(
    context,
    userId,
    organizationId
  )

  if (hasOrgAdminAccess) {
    context.request.authzCache.leagueAccessByLeagueId.set(leagueId, true)
    return userId
  }

  const leagueMembership = await context.prisma.leagueMembership.findUnique({
    where: {
      leagueId_userId: {
        leagueId,
        userId
      }
    },
    select: { status: true }
  })

  const hasLeagueMembership =
    leagueMembership?.status === leagueMembershipStatusActive

  context.request.authzCache.leagueAccessByLeagueId.set(
    leagueId,
    hasLeagueMembership
  )

  if (!hasLeagueMembership) {
    throw new Error(leagueAccessRequiredMessage)
  }

  return userId
}

export const requireOccurrenceLeagueAccess = async (
  context: AppContext,
  occurrenceId: string
): Promise<string> => {
  const leagueId = await resolveOccurrenceLeagueId(context, occurrenceId)
  return requireLeagueAccess(context, leagueId)
}
