import { prisma } from '../../shared/prisma.js'

/**
 * RegistrationService
 * - Upserts attendance registrations for sessions.
 * - Cancels attendance when requested.
 * - Used by registration mutations.
 */
export class RegistrationService {
  public async register(userId: string, sessionId: string) {
    return prisma.sessionRegistration.upsert({
      where: { userId_sessionId: { userId, sessionId } },
      create: {
        userId,
        sessionId,
        status: 'ATTENDING'
      },
      update: { status: 'ATTENDING' }
    })
  }

  public async cancel(userId: string, sessionId: string) {
    return prisma.sessionRegistration.update({
      where: { userId_sessionId: { userId, sessionId } },
      data: { status: 'CANCELED' }
    })
  }
}
