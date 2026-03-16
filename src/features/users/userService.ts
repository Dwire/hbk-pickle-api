import type { RegistrationStatus, SubSignupStatus, User } from '../../generated/prisma/client.js'
import { logger } from '../../shared/logger.js'
import { prisma } from '../../shared/prisma.js'

const logUpsertingDisplayName = 'Upserting user display name'
const logUpsertedDisplayName = 'Upserted user display name'
const messageUserMissingForDisplayName = 'User missing for display name update'
const logLoadedProfileStatsMemberships = 'Loaded user league memberships for profile stats'
const logResolvedProfileStatsCurrentLeague = 'Resolved current league for profile stats'
const logComputedProfileStatsCounts = 'Computed profile stats counts'
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
const leagueStatusActive = 'ACTIVE'
const leagueMembershipStatusActive = 'ACTIVE'

type LeagueSummary = {
  id: string
  name: string
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
