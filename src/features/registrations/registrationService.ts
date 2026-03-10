import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { SessionService } from '../sessions/sessionService.js'
import { getEasternDayRangeUtc } from '../../shared/time.js'

/**
 * RegistrationService
 * - Upserts attendance registrations for sessions.
 * - Cancels attendance when requested.
 * - Used by registration mutations.
 */
export class RegistrationService {
  public async register(userId: string, occurrenceId: string) {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { session: true }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const sessionService = new SessionService()
    const now = new Date()

    if (!sessionService.isWithinRegistrationWindow(now, occurrence.startsAt)) {
      logger.warn({ occurrenceId, userId }, 'Registration attempt outside window')
      throw new Error('Registration window closed')
    }

    const assignment = await prisma.slotAssignment.findFirst({
      where: { userId, sessionId: occurrence.sessionId }
    })

    if (!assignment) {
      logger.warn({ occurrenceId, userId }, 'Registration attempt without assignment')
      throw new Error('User not assigned to this session')
    }

    const { start, end } = getEasternDayRangeUtc(occurrence.startsAt)
    const existingRegistration = await prisma.sessionRegistration.findFirst({
      where: {
        userId,
        status: 'ATTENDING',
        occurrence: {
          startsAt: { gte: start, lte: end }
        }
      }
    })

    if (existingRegistration && existingRegistration.occurrenceId !== occurrenceId) {
      logger.warn({ occurrenceId, userId }, 'Registration attempt with same-day attendance')
      throw new Error('User already registered for a session that day')
    }

    const registration = await prisma.sessionRegistration.upsert({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      create: {
        userId,
        occurrenceId,
        status: 'ATTENDING'
      },
      update: { status: 'ATTENDING' }
    })

    logger.info({ occurrenceId, userId }, 'User registered for session')
    return registration
  }

  public async cancel(userId: string, occurrenceId: string) {
    return prisma.sessionRegistration.update({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      data: { status: 'CANCELED' }
    })
  }
}
