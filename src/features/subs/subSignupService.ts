import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { SessionService } from '../sessions/sessionService.js'
import { getEasternDayRangeUtc } from '../../shared/time.js'

/**
 * SubSignupService
 * - Upserts sub signups for sessions.
 * - Cancels sub signups when requested.
 * - Used by sub signup mutations.
 */
export class SubSignupService {
  public async signup(userId: string, occurrenceId: string) {
    const errorOccurrenceMissing = 'Session occurrence missing'
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { session: true }
    })

    if (!occurrence) {
      throw new Error(errorOccurrenceMissing)
    }

    const sessionService = new SessionService()
    const now = new Date()
    const logSubSignupOutsideWindow = 'Sub signup attempt outside window'
    const logResolvedSubSignupAssignmentStatus = 'Resolved sub signup assignment status'
    const logResolvedSubSignupEligibility = 'Resolved sub signup eligibility'
    const logSubSignupSameDayRegistration = 'Sub signup attempt with same-day attendance'
    const logSubSignupSameDaySubSignup = 'Sub signup attempt with existing sub on same day'
    const logUserSignedUpAsSub = 'User signed up as sub'
    const errorSubSignupWindowClosed = 'Sub signup window closed'
    const errorUserAlreadyRegisteredSameDay = 'User already registered for a session that day'
    const errorUserAlreadySignedUpAsSubSameDay = 'User already signed up as a sub that day'

    if (!sessionService.isWithinSubSignupWindow(now, occurrence.endsAt)) {
      logger.warn({ occurrenceId, userId }, logSubSignupOutsideWindow)
      throw new Error(errorSubSignupWindowClosed)
    }

    const assignment = await prisma.slotAssignment.findFirst({
      where: { userId, sessionId: occurrence.sessionId }
    })
    const isUserAssignedToSession = Boolean(assignment)
    logger.info({ occurrenceId, userId, isUserAssignedToSession }, logResolvedSubSignupAssignmentStatus)

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

    const existingSubSignup = await prisma.subSignup.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'SELECTED'] },
        occurrence: {
          startsAt: { gte: start, lte: end }
        }
      }
    })

    logger.info(
      {
        occurrenceId,
        userId,
        isUserAssignedToSession,
        hasSameDayRegistration: Boolean(existingRegistration),
        hasSameDaySubSignup: Boolean(existingSubSignup),
        existingSubSignupOccurrenceId: existingSubSignup?.occurrenceId ?? null
      },
      logResolvedSubSignupEligibility
    )

    if (existingRegistration) {
      logger.warn({ occurrenceId, userId }, logSubSignupSameDayRegistration)
      throw new Error(errorUserAlreadyRegisteredSameDay)
    }

    if (existingSubSignup && existingSubSignup.occurrenceId !== occurrenceId) {
      logger.warn({ occurrenceId, userId }, logSubSignupSameDaySubSignup)
      throw new Error(errorUserAlreadySignedUpAsSubSameDay)
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

    logger.info({ occurrenceId, userId }, logUserSignedUpAsSub)
    return subSignup
  }

  public async cancel(userId: string, occurrenceId: string) {
    const logUserCanceledSubSignup = 'User canceled sub signup'
    const subSignup = await prisma.subSignup.update({
      where: { userId_occurrenceId: { userId, occurrenceId } },
      data: { status: 'CANCELED' }
    })

    logger.info({ occurrenceId, userId }, logUserCanceledSubSignup)
    return subSignup
  }
}
