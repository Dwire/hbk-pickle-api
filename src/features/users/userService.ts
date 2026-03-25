import { subSelectionQueue } from '../../integrations/bull/queue.js'
import type {
  LeagueStatus,
  OrganizationMembershipRole,
  RegistrationStatus,
  SubSignupStatus,
  User
} from '../../generated/prisma/client.js'
import { logger } from '../../shared/logger.js'
import { prisma } from '../../shared/prisma.js'

const logUpsertingDisplayName = 'Upserting user display name'
const logUpsertedDisplayName = 'Upserted user display name'
const messageUserMissingForDisplayName = 'User missing for display name update'
const messageUserMissingForDelete = 'User missing for account deletion'
const logLoadedProfileStatsMemberships = 'Loaded user league memberships for profile stats'
const logResolvedProfileStatsCurrentLeague = 'Resolved current league for profile stats'
const logComputedProfileStatsCounts = 'Computed profile stats counts'
const logLoadedUserOrganizations = 'Loaded user organizations'
const logLoadedPlayerOrganizations = 'Loaded player organizations'
const logResolvedDeleteAccountGuard = 'Resolved delete account owner/admin guard'
const logBlockedDeleteAccountSoleAdmin = 'Blocked delete account for sole org owner/admin'
const logDeletingAccount = 'Deleting user account and associated records'
const logDeletedAccount = 'Deleted user account and associated records'
const logQueuedDeleteAccountSubSelectionJobs =
  'Queued sub-selection jobs for account deletion impacts'
const deleteAccountSoleAdminErrorPrefix =
  'Cannot delete account while you are the only OWNER/ADMIN in organizations'
const profileStatsZeroCount = 0
const subSignupStatusActive: SubSignupStatus = 'ACTIVE'
const subSignupStatusSelected: SubSignupStatus = 'SELECTED'
const subSignupStatusReplaced: SubSignupStatus = 'REPLACED'
const subSignupStatusesNotCanceled: SubSignupStatus[] = [
  subSignupStatusActive,
  subSignupStatusSelected,
  subSignupStatusReplaced
]
const registrationStatusAttending: RegistrationStatus = 'ATTENDING'
const sessionOccurrenceStatusActive = 'ACTIVE'
const leagueStatusActive: LeagueStatus = 'ACTIVE'
const leagueStatusUpcoming: LeagueStatus = 'UPCOMING'
const leagueStatusArchived: LeagueStatus = 'ARCHIVED'
const leagueMembershipStatusActive = 'ACTIVE'
const leagueStatusesForPlayerOrganizations: LeagueStatus[] = [
  leagueStatusActive,
  leagueStatusUpcoming,
  leagueStatusArchived
]
const organizationMembershipRoleOwner: OrganizationMembershipRole = 'OWNER'
const organizationMembershipRoleAdmin: OrganizationMembershipRole = 'ADMIN'
const organizationMembershipRolesWithAdminAccess: OrganizationMembershipRole[] =
  [organizationMembershipRoleOwner, organizationMembershipRoleAdmin]
const subSelectionJobName = 'sub-selection'
const subSelectionJobIdPrefix = 'sub-selection'
const subSelectionJobIdSeparator = '-'
const subSelectionJobAttempts = 3
const subSelectionJobBackoffTypeExponential = 'exponential'
const subSelectionJobBackoffDelayMs = 1_000
const sortOrderAscending = 'asc'

type SubSelectionQueuePayload = {
  occurrenceId: string
}

type LeagueSummary = {
  id: string
  name: string
}

type OrganizationSummary = {
  id: string
  name: string
  slug: string
}

export type ProfileStats = {
  currentLeague: LeagueSummary | null
  leaguesParticipated: LeagueSummary[]
  subSignupCount: number
  subSelectedCount: number
  attendanceCount: number
  missedCount: number
}

/**
 * UserService
 * - Updates user profile fields like displayName.
 * - Aggregates profile stats for the profile page.
 * - Persists changes through Prisma's user model.
 * - Used by authenticated GraphQL profile queries and mutations.
 */
export class UserService {
  private async resolveDeleteAccountBlockedOrganizations(
    userId: string
  ): Promise<{ organizationId: string; organizationName: string }[]> {
    const adminMemberships = await prisma.organizationMembership.findMany({
      where: {
        userId,
        role: {
          in: organizationMembershipRolesWithAdminAccess
        }
      },
      select: {
        organizationId: true,
        organization: {
          select: {
            name: true
          }
        }
      }
    })

    if (adminMemberships.length === 0) {
      logger.info(
        { userId, guardedOrganizationCount: 0, blockedOrganizationCount: 0 },
        logResolvedDeleteAccountGuard
      )
      return []
    }

    const guardedOrganizationIds = adminMemberships.map(
      (membership) => membership.organizationId
    )
    const peerAdminMemberships = await prisma.organizationMembership.findMany({
      where: {
        organizationId: { in: guardedOrganizationIds },
        userId: { not: userId },
        role: { in: organizationMembershipRolesWithAdminAccess }
      },
      select: {
        organizationId: true
      }
    })

    const organizationIdsWithPeerAdmins = new Set(
      peerAdminMemberships.map((membership) => membership.organizationId)
    )
    const blockedOrganizations = adminMemberships
      .filter(
        (membership) =>
          !organizationIdsWithPeerAdmins.has(membership.organizationId)
      )
      .map((membership) => ({
        organizationId: membership.organizationId,
        organizationName: membership.organization.name
      }))

    logger.info(
      {
        userId,
        guardedOrganizationCount: adminMemberships.length,
        blockedOrganizationCount: blockedOrganizations.length
      },
      logResolvedDeleteAccountGuard
    )
    return blockedOrganizations
  }

  private async resolveDeleteAccountAffectedOccurrenceIds(
    userId: string
  ): Promise<string[]> {
    const [registrations, subSignups] = await Promise.all([
      prisma.sessionRegistration.findMany({
        where: { userId },
        select: { occurrenceId: true }
      }),
      prisma.subSignup.findMany({
        where: { userId },
        select: { occurrenceId: true }
      })
    ])

    return Array.from(
      new Set([
        ...registrations.map((registration) => registration.occurrenceId),
        ...subSignups.map((subSignup) => subSignup.occurrenceId)
      ])
    )
  }

  private async queueDeleteAccountSubSelectionJobs(
    userId: string,
    affectedOccurrenceIds: string[]
  ): Promise<void> {
    if (affectedOccurrenceIds.length === 0) {
      logger.info(
        {
          userId,
          affectedOccurrenceCount: 0,
          eligibleOccurrenceCount: 0,
          queuedCount: 0,
          skippedExistingCount: 0
        },
        logQueuedDeleteAccountSubSelectionJobs
      )
      return
    }

    const now = new Date()
    const eligibleOccurrences = await prisma.sessionOccurrence.findMany({
      where: {
        id: { in: affectedOccurrenceIds },
        status: sessionOccurrenceStatusActive,
        endsAt: { gt: now }
      },
      select: { id: true },
      orderBy: { id: sortOrderAscending }
    })

    let queuedCount = 0
    let skippedExistingCount = 0

    for (const occurrence of eligibleOccurrences) {
      const jobId = `${subSelectionJobIdPrefix}${subSelectionJobIdSeparator}${occurrence.id}`
      const existingJob = await subSelectionQueue.getJob(jobId)
      if (existingJob) {
        skippedExistingCount += 1
        continue
      }

      await subSelectionQueue.add(
        subSelectionJobName,
        {
          occurrenceId: occurrence.id
        } as SubSelectionQueuePayload,
        {
          jobId,
          attempts: subSelectionJobAttempts,
          backoff: {
            type: subSelectionJobBackoffTypeExponential,
            delay: subSelectionJobBackoffDelayMs
          },
          removeOnComplete: true,
          removeOnFail: true
        }
      )
      queuedCount += 1
    }

    logger.info(
      {
        userId,
        affectedOccurrenceCount: affectedOccurrenceIds.length,
        eligibleOccurrenceCount: eligibleOccurrences.length,
        queuedCount,
        skippedExistingCount
      },
      logQueuedDeleteAccountSubSelectionJobs
    )
  }

  /**
   * List organizations where the authenticated user has membership.
   */
  public async listOrganizations(userId: string): Promise<OrganizationSummary[]> {
    const memberships = await prisma.organizationMembership.findMany({
      where: { userId },
      orderBy: {
        organization: {
          name: 'asc'
        }
      },
      select: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    })

    logger.info({ userId, organizationCount: memberships.length }, logLoadedUserOrganizations)

    return memberships.map((membership) => membership.organization)
  }

  /**
   * List organizations where the authenticated user is eligible through league memberships.
   * Eligibility requires ACTIVE league membership on ACTIVE, UPCOMING, or ARCHIVED leagues.
   */
  public async listPlayerOrganizations(userId: string): Promise<OrganizationSummary[]> {
    const organizations = await prisma.organization.findMany({
      where: {
        leagues: {
          some: {
            status: { in: leagueStatusesForPlayerOrganizations },
            memberships: {
              some: {
                userId,
                status: leagueMembershipStatusActive
              }
            }
          }
        }
      },
      orderBy: {
        name: sortOrderAscending
      },
      select: {
        id: true,
        name: true,
        slug: true
      }
    })

    logger.info({ userId, organizationCount: organizations.length }, logLoadedPlayerOrganizations)

    return organizations
  }

  /**
   * Upserts the display name for the authenticated user.
   */
  public async upsertDisplayName(userId: string, displayName: string): Promise<User> {
    logger.info({ userId, displayName }, logUpsertingDisplayName)
    const existingUser = await prisma.user.findUnique({ where: { id: userId } })

    if (!existingUser) {
      logger.warn({ userId }, messageUserMissingForDisplayName)
      throw new Error(messageUserMissingForDisplayName)
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { displayName }
    })

    logger.info({ userId, displayName, updatedAt: updatedUser.updatedAt }, logUpsertedDisplayName)
    return updatedUser
  }

  /**
   * Permanently delete the authenticated user and all directly associated data.
   * - Blocks deletion if the user is the sole OWNER/ADMIN in any organization.
   * - Deletes associated rows in FK-safe order for ON DELETE RESTRICT relations.
   * - Re-queues sub-selection for active impacted occurrences after commit.
   */
  public async deleteMyAccount(userId: string): Promise<void> {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    })

    if (!existingUser) {
      logger.warn({ userId }, messageUserMissingForDelete)
      throw new Error(messageUserMissingForDelete)
    }

    const blockedOrganizations = await this.resolveDeleteAccountBlockedOrganizations(
      userId
    )
    if (blockedOrganizations.length > 0) {
      const blockedOrganizationNames = blockedOrganizations.map(
        (organization) => organization.organizationName
      )
      const blockedOrganizationNameList = blockedOrganizationNames.join(', ')
      logger.warn(
        {
          userId,
          blockedOrganizationCount: blockedOrganizations.length,
          blockedOrganizationIds: blockedOrganizations.map(
            (organization) => organization.organizationId
          ),
          blockedOrganizationNames
        },
        logBlockedDeleteAccountSoleAdmin
      )
      throw new Error(
        `${deleteAccountSoleAdminErrorPrefix}: ${blockedOrganizationNameList}`
      )
    }

    const affectedOccurrenceIds =
      await this.resolveDeleteAccountAffectedOccurrenceIds(userId)

    logger.info(
      {
        userId,
        affectedOccurrenceCount: affectedOccurrenceIds.length
      },
      logDeletingAccount
    )

    const deletedCounts = await prisma.$transaction(async (tx) => {
      const deletedNotifications = await tx.notification.deleteMany({
        where: { userId }
      })
      const deletedDevices = await tx.userDevice.deleteMany({
        where: { userId }
      })
      const deletedRegistrations = await tx.sessionRegistration.deleteMany({
        where: { userId }
      })
      const deletedSubSignups = await tx.subSignup.deleteMany({
        where: { userId }
      })
      const deletedSlotAssignments = await tx.slotAssignment.deleteMany({
        where: { userId }
      })
      const deletedLeagueMemberships = await tx.leagueMembership.deleteMany({
        where: { userId }
      })
      const deletedOrganizationMemberships =
        await tx.organizationMembership.deleteMany({
          where: { userId }
        })
      await tx.user.delete({
        where: { id: userId }
      })

      return {
        deletedNotifications: deletedNotifications.count,
        deletedDevices: deletedDevices.count,
        deletedRegistrations: deletedRegistrations.count,
        deletedSubSignups: deletedSubSignups.count,
        deletedSlotAssignments: deletedSlotAssignments.count,
        deletedLeagueMemberships: deletedLeagueMemberships.count,
        deletedOrganizationMemberships: deletedOrganizationMemberships.count
      }
    })

    logger.info(
      {
        userId,
        ...deletedCounts
      },
      logDeletedAccount
    )

    try {
      await this.queueDeleteAccountSubSelectionJobs(userId, affectedOccurrenceIds)
    } catch (error) {
      logger.error(
        {
          userId,
          affectedOccurrenceCount: affectedOccurrenceIds.length,
          error
        },
        logQueuedDeleteAccountSubSelectionJobs
      )
    }
  }

  /**
   * Build profile stats for the authenticated user.
   * - Resolves current league from active league memberships (active league preferred).
   * - Returns all leagues where the user has league membership history.
   * - Aggregates sub/attendance counts scoped to the current league.
   */
  public async getProfileStats(userId: string): Promise<ProfileStats> {
    const memberships = await prisma.leagueMembership.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        status: true,
        updatedAt: true,
        league: { select: { id: true, name: true, status: true, updatedAt: true } }
      }
    })

    logger.info({ userId, membershipCount: memberships.length }, logLoadedProfileStatsMemberships)

    const leaguesById = new Map<string, LeagueSummary>()
    memberships.forEach((membership) => {
      if (!leaguesById.has(membership.league.id)) {
        leaguesById.set(membership.league.id, {
          id: membership.league.id,
          name: membership.league.name
        })
      }
    })

    const activeMembership = memberships.find(
      (membership) =>
        membership.status === leagueMembershipStatusActive &&
        membership.league.status === leagueStatusActive
    )
    const currentMembership = activeMembership ?? memberships[0] ?? null
    const currentLeague = currentMembership
      ? {
          id: currentMembership.league.id,
          name: currentMembership.league.name
        }
      : null

    logger.info(
      {
        userId,
        currentLeagueId: currentLeague?.id ?? null,
        currentLeagueStatus: currentMembership?.league.status ?? null,
        leaguesParticipatedCount: leaguesById.size
      },
      logResolvedProfileStatsCurrentLeague
    )

    if (!currentLeague) {
      return {
        currentLeague,
        leaguesParticipated: Array.from(leaguesById.values()),
        subSignupCount: profileStatsZeroCount,
        subSelectedCount: profileStatsZeroCount,
        attendanceCount: profileStatsZeroCount,
        missedCount: profileStatsZeroCount
      }
    }

    const currentLeagueId = currentLeague.id
    const [subSignupCount, subSelectedCount, attendanceCount, totalRegistrationCount] = await Promise.all([
      prisma.subSignup.count({
        where: {
          userId,
          status: { in: subSignupStatusesNotCanceled },
          occurrence: { status: sessionOccurrenceStatusActive, session: { leagueId: currentLeagueId } }
        }
      }),
      prisma.subSignup.count({
        where: {
          userId,
          status: subSignupStatusSelected,
          occurrence: { status: sessionOccurrenceStatusActive, session: { leagueId: currentLeagueId } }
        }
      }),
      prisma.sessionRegistration.count({
        where: {
          userId,
          status: registrationStatusAttending,
          occurrence: { status: sessionOccurrenceStatusActive, session: { leagueId: currentLeagueId } }
        }
      }),
      prisma.sessionRegistration.count({
        where: {
          userId,
          occurrence: { status: sessionOccurrenceStatusActive, session: { leagueId: currentLeagueId } }
        }
      })
    ])

    const missedCount = Math.max(totalRegistrationCount - attendanceCount, profileStatsZeroCount)

    logger.info(
      {
        userId,
        currentLeagueId,
        subSignupCount,
        subSelectedCount,
        attendanceCount,
        totalRegistrationCount,
        missedCount
      },
      logComputedProfileStatsCounts
    )

    return {
      currentLeague,
      leaguesParticipated: Array.from(leaguesById.values()),
      subSignupCount,
      subSelectedCount,
      attendanceCount,
      missedCount
    }
  }
}
