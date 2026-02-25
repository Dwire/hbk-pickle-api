import { prisma } from '../../shared/prisma.js'

/**
 * RuleService
 * - Lists and upserts league rules.
 * - Used by rules query and admin mutation.
 */
export class RuleService {
  public async listRules() {
    return prisma.leagueRule.findMany({ orderBy: { order: 'asc' } })
  }

  public async upsertRule(title: string, body: string, order: number) {
    const league = await prisma.league.findFirst()

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
