import { prisma } from '../../shared/prisma.js'
import { registrationCloseHour, registrationOpenHour, sessionCapacityDefault } from '../../shared/constants.js'

type SessionWindow = {
  registrationOpenAt: Date
  registrationCloseAt: Date
}

/**
 * SessionService
 * - Lists sessions with derived registration windows.
 * - Creates sessions tied to the default league.
 * - Used by session queries and admin mutations.
 */
export class SessionService {
  public async listSessions(start: Date, end: Date) {
    const sessions = await prisma.session.findMany({
      where: {
        startTime: { gte: start },
        endTime: { lte: end }
      },
      orderBy: { startTime: 'asc' }
    })

    return sessions.map((session: (typeof sessions)[number]) => ({
      ...session,
      ...this.calculateRegistrationWindow(session.startTime),
      capacity: session.capacity || sessionCapacityDefault
    }))
  }

  public async createSession(title: string, startTime: Date, endTime: Date, capacity?: number) {
    return prisma.session.create({
      data: {
        league: { connect: { id: await this.getDefaultLeagueId() } },
        title,
        startTime,
        endTime,
        capacity: capacity ?? sessionCapacityDefault
      }
    })
  }

  private calculateRegistrationWindow(startTime: Date): SessionWindow {
    const openAt = new Date(startTime)
    openAt.setDate(openAt.getDate() - 1)
    openAt.setHours(registrationOpenHour, 0, 0, 0)

    const closeAt = new Date(startTime)
    closeAt.setDate(closeAt.getDate() - 1)
    closeAt.setHours(registrationCloseHour, 0, 0, 0)

    return { registrationOpenAt: openAt, registrationCloseAt: closeAt }
  }

  private async getDefaultLeagueId(): Promise<string> {
    const league = await prisma.league.findFirst()

    if (!league) {
      const created = await prisma.league.create({
        data: { name: 'Default League' }
      })
      return created.id
    }

    return league.id
  }
}
