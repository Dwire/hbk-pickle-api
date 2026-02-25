import { notificationQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { registrationCloseWarningMinutes, sessionStartWarningMinutes } from '../../shared/constants.js'

type QueuePayload = {
  notificationId: string
  deviceTokens: string[]
}

export class RegistrationScheduler {
  public async queueRegistrationCloseWarnings(now: Date): Promise<void> {
    const upcoming = await prisma.session.findMany({
      where: {
        startTime: { gte: now }
      }
    })

    for (const session of upcoming) {
      const closeWarningAt = new Date(session.startTime)
      closeWarningAt.setDate(closeWarningAt.getDate() - 1)
      closeWarningAt.setHours(21, -registrationCloseWarningMinutes, 0, 0)

      if (closeWarningAt <= now) {
        continue
      }

      const registrationUsers = await prisma.sessionRegistration.findMany({
        where: { sessionId: session.id, status: 'ATTENDING' },
        include: { user: { include: { devices: true } } }
      })

      for (const registration of registrationUsers) {
        const notification = await prisma.notification.create({
          data: {
            userId: registration.userId,
            sessionId: session.id,
            title: 'Registration closes soon',
            body: `Registration closes in ${registrationCloseWarningMinutes} minutes.`,
            channel: 'PUSH',
            status: 'PENDING'
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
    const upcoming = await prisma.session.findMany({
      where: {
        startTime: { gte: now }
      }
    })

    for (const session of upcoming) {
      const warningAt = new Date(session.startTime)
      warningAt.setMinutes(warningAt.getMinutes() - sessionStartWarningMinutes)

      if (warningAt <= now) {
        continue
      }

      const attendees = await prisma.sessionRegistration.findMany({
        where: { sessionId: session.id, status: 'ATTENDING' },
        include: { user: { include: { devices: true } } }
      })

      for (const registration of attendees) {
        const notification = await prisma.notification.create({
          data: {
            userId: registration.userId,
            sessionId: session.id,
            title: 'Session starting soon',
            body: `Your session starts in ${sessionStartWarningMinutes} minutes.`,
            channel: 'PUSH',
            status: 'PENDING'
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
}
