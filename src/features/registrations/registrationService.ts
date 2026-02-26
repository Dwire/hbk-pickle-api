import { prisma } from '../../shared/prisma.js'

/**
 * RegistrationService
 * - Upserts attendance registrations for sessions.
 * - Cancels attendance when requested.
 * - Used by registration mutations.
 */
export class RegistrationService {
  public async register(userId: string, occurrenceId: string) {
    return prisma.sessionRegistration.upsert({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      create: {
        userId,
        occurrenceId,
        status: 'ATTENDING'
      },
      update: { status: 'ATTENDING' }
    })
  }

  public async cancel(userId: string, occurrenceId: string) {
    return prisma.sessionRegistration.update({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      data: { status: 'CANCELED' }
    })
  }
}
