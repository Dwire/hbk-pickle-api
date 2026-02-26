import { prisma } from '../../shared/prisma.js'

/**
 * SubSignupService
 * - Upserts sub signups for sessions.
 * - Cancels sub signups when requested.
 * - Used by sub signup mutations.
 */
export class SubSignupService {
  public async signup(userId: string, occurrenceId: string) {
    return prisma.subSignup.upsert({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      create: {
        userId,
        occurrenceId,
        status: 'ACTIVE'
      },
      update: { status: 'ACTIVE' }
    })
  }

  public async cancel(userId: string, occurrenceId: string) {
    return prisma.subSignup.update({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      data: { status: 'CANCELED' }
    })
  }
}
