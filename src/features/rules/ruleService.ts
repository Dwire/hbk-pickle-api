import { prisma } from '../../shared/prisma.js'

const ascendingSortOrder = 'asc'
const descendingSortOrder = 'desc'
const leagueStatusActive = 'ACTIVE'

/**
 * RuleService
 * - Lists and upserts league rules for the resolved league context.
 * - Used by rules query and admin mutation.
 */
export class RuleService {
  private async resolveLeagueIdForRules(userId: string | null): Promise<string | null> {
    if (userId) {
      const activeAssignment = await prisma.slotAssignment.findFirst({
        where: { userId, league: { status: leagueStatusActive } },
        orderBy: { createdAt: descendingSortOrder },
        select: { leagueId: true }
      })

      if (activeAssignment) {
        return activeAssignment.leagueId
      }

      const latestAssignment = await prisma.slotAssignment.findFirst({
        where: { userId },
        orderBy: { createdAt: descendingSortOrder },
        select: { leagueId: true }
      })

      if (latestAssignment) {
        return latestAssignment.leagueId
      }
    }

    const activeLeague = await prisma.league.findFirst({
      where: { status: leagueStatusActive },
      orderBy: { createdAt: descendingSortOrder },
      select: { id: true }
    })

    if (activeLeague) {
      return activeLeague.id
    }

    const fallbackLeague = await prisma.league.findFirst({
      orderBy: { createdAt: ascendingSortOrder },
      select: { id: true }
    })

    return fallbackLeague?.id ?? null
  }

  public async listRules(userId: string | null) {
    const leagueId = await this.resolveLeagueIdForRules(userId)

    if (!leagueId) {
      return []
    }

    return prisma.leagueRule.findMany({
      where: { leagueId },
      orderBy: { order: ascendingSortOrder }
    })
  }

  public async upsertRule(title: string, body: string, order: number) {
    const activeLeague = await prisma.league.findFirst({
      where: { status: leagueStatusActive },
      orderBy: { createdAt: descendingSortOrder },
      select: { id: true }
    })
    const league =
      activeLeague ??
      (await prisma.league.findFirst({
        orderBy: { createdAt: ascendingSortOrder },
        select: { id: true }
      }))

    if (!league) {
      throw new Error('League missing')
    }

    return prisma.leagueRule.upsert({
      where: { leagueId_order: { leagueId: league.id, order } },
      create: { leagueId: league.id, title, body, order },
      update: { title, body }
    })
  }
}
