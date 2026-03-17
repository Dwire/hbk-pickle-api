import { prisma } from '../../shared/prisma.js'

const ascendingSortOrder = 'asc'

/**
 * RuleService
 * - Lists and upserts league rules for explicit league context.
 * - Used by rules query and admin mutations.
 */
export class RuleService {
  public async listRules(leagueId: string) {
    return prisma.leagueRule.findMany({
      where: { leagueId },
      orderBy: { order: ascendingSortOrder }
    })
  }

  public async upsertRule(leagueId: string, title: string, body: string, order: number) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true }
    })

    if (!league) {
      throw new Error('League missing')
    }

    return prisma.leagueRule.upsert({
      where: { leagueId_order: { leagueId, order } },
      create: { leagueId, title, body, order },
      update: { title, body }
    })
  }
}
