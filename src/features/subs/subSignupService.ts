import { prisma } from '../../shared/prisma.js'

/**
 * SubSignupService
 * - Upserts sub signups for sessions.
 * - Cancels sub signups when requested.
 * - Used by sub signup mutations.
 */
export class SubSignupService {
  public async signup(userId: string, sessionId: string) {
    return prisma.subSignup.upsert({
      where: { userId_sessionId: { userId, sessionId } },
      create: {
        userId,
        sessionId,
        status: 'ACTIVE'
      },
      update: { status: 'ACTIVE' }
    })
  }

  public async cancel(userId: string, sessionId: string) {
    return prisma.subSignup.update({
      where: { userId_sessionId: { userId, sessionId } },
      data: { status: 'CANCELED' }
    })
  }
}
