import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { SessionService, getEasternDayRangeUtc } from '../sessions/sessionService.js'

/**
 * SubSignupService
 * - Upserts sub signups for sessions.
 * - Cancels sub signups when requested.
 * - Used by sub signup mutations.
 */
export class SubSignupService {
  public async signup(userId: string, occurrenceId: string) {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { session: true }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const sessionService = new SessionService()
    const now = new Date()
    const logSubSignupOutsideWindow = 'Sub signup attempt outside window'
    const errorSubSignupWindowClosed = 'Sub signup window closed'

    if (!sessionService.isWithinSubSignupWindow(now, occurrence.endsAt)) {
      logger.warn({ occurrenceId, userId }, logSubSignupOutsideWindow)
      throw new Error(errorSubSignupWindowClosed)
    }

    const assignment = await prisma.slotAssignment.findFirst({
      where: { userId, sessionId: occurrence.sessionId }
    })

    if (assignment) {
      logger.warn({ occurrenceId, userId }, 'Sub signup attempt for assigned session')
      throw new Error('Assigned players cannot sub for their session')
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

    if (existingRegistration) {
      logger.warn({ occurrenceId, userId }, 'Sub signup attempt with same-day attendance')
      throw new Error('User already registered for a session that day')
    }

    const existingSubSignup = await prisma.subSignup.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'SELECTED'] },
        occurrence: {
          startsAt: { gte: start, lte: end }
        }
      }
    })

    if (existingSubSignup && existingSubSignup.occurrenceId !== occurrenceId) {
      logger.warn({ occurrenceId, userId }, 'Sub signup attempt with existing sub on same day')
      throw new Error('User already signed up as a sub that day')
    }

    const subSignup = await prisma.subSignup.upsert({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      create: {
        userId,
        occurrenceId,
        status: 'ACTIVE'
      },
      update: { status: 'ACTIVE' }
    })

    logger.info({ occurrenceId, userId }, 'User signed up as sub')
    return subSignup
  }

  public async cancel(userId: string, occurrenceId: string) {
    const subSignup = await prisma.subSignup.update({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      data: { status: 'CANCELED' }
    })

    logger.info({ occurrenceId, userId }, 'User canceled sub signup')
    return subSignup
  }
}
