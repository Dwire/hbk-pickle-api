import { notificationQueue, subSelectionQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { registrationCloseWarningMinutes, sessionStartWarningMinutes } from '../../shared/constants.js'
import { SessionService } from '../../features/sessions/sessionService.js'
import { getEasternRegistrationCloseWarningAt } from '../../shared/time.js'

type QueuePayload = {
  notificationId: string
  deviceTokens: string[]
}

type SubSelectionQueuePayload = {
  occurrenceId: string
}

const subSelectionJobName = 'sub-selection'
const subSelectionJobIdPrefix = 'sub-selection'
const subSelectionJobAttempts = 3
const subSelectionJobBackoffDelayMs = 1_000

export class RegistrationScheduler {
  private sessionService = new SessionService()

  public async queueRegistrationCloseWarnings(now: Date): Promise<void> {
    const upcoming = await prisma.sessionOccurrence.findMany({
      where: {
        startsAt: { gte: now }
      }
    })

    for (const occurrence of upcoming) {
      const closeWarningAt = getEasternRegistrationCloseWarningAt(
        occurrence.startsAt,
        registrationCloseWarningMinutes
      )

      if (closeWarningAt <= now) {
        continue
      }

      const registrationUsers = await prisma.sessionRegistration.findMany({
        where: { occurrenceId: occurrence.id, status: 'ATTENDING' },
        include: { user: { include: { devices: true } } }
      })

      for (const registration of registrationUsers) {
        const notification = await prisma.notification.create({
          data: {
            userId: registration.userId,
            occurrenceId: occurrence.id,
            title: 'Registration closes soon',
            body: `Registration closes in ${registrationCloseWarningMinutes} minutes.`,
            channel: 'PUSH',
            status: 'PENDING',
            kind: 'REGISTRATION_CLOSE_WARNING'
          }
        })

        const deviceTokens = registration.user.devices.map((device: (typeof registration.user.devices)[number]) => device.token)

        if (deviceTokens.length === 0) {
          continue
        }

        await notificationQueue.add('registration-close-warning', {
          notificationId: notification.id,
          deviceTokens
        } as QueuePayload)
      }
    }

    logger.info('Queued registration close warnings')
  }

  public async queueSessionStartWarnings(now: Date): Promise<void> {
    const upcoming = await prisma.sessionOccurrence.findMany({
      where: {
        startsAt: { gte: now }
      }
    })

    for (const occurrence of upcoming) {
      const warningAt = new Date(occurrence.startsAt.getTime() - sessionStartWarningMinutes * 60_000)

      if (warningAt <= now) {
        continue
      }

      const attendees = await prisma.sessionRegistration.findMany({
        where: { occurrenceId: occurrence.id, status: 'ATTENDING' },
        include: { user: { include: { devices: true } } }
      })

      for (const registration of attendees) {
        const notification = await prisma.notification.create({
          data: {
            userId: registration.userId,
            occurrenceId: occurrence.id,
            title: 'Session starting soon',
            body: `Your session starts in ${sessionStartWarningMinutes} minutes.`,
            channel: 'PUSH',
            status: 'PENDING',
            kind: 'SESSION_START_WARNING'
          }
        })

        const deviceTokens = registration.user.devices.map((device: (typeof registration.user.devices)[number]) => device.token)

        if (deviceTokens.length === 0) {
          continue
        }

        await notificationQueue.add('session-start-warning', {
          notificationId: notification.id,
          deviceTokens
        } as QueuePayload)
      }
    }

    logger.info('Queued session start warnings')
  }

  public async queueSubSelection(now: Date): Promise<void> {
    const activeOccurrences = await prisma.sessionOccurrence.findMany({
      where: {
        endsAt: { gt: now }
      }
    })

    let queuedCount = 0

    for (const occurrence of activeOccurrences) {
      const { registrationCloseAt } = this.sessionService.calculateRegistrationWindow(occurrence.startsAt)

      if (registrationCloseAt > now) {
        continue
      }

      const jobId = `${subSelectionJobIdPrefix}:${occurrence.id}`

      await subSelectionQueue.add(
        subSelectionJobName,
        { occurrenceId: occurrence.id } as SubSelectionQueuePayload,
        {
          jobId,
          attempts: subSelectionJobAttempts,
          backoff: {
            type: 'exponential',
            delay: subSelectionJobBackoffDelayMs
          },
          removeOnComplete: true
        }
      )

      queuedCount += 1
    }

    logger.info({ queuedCount }, 'Queued sub selection jobs')
  }
}
