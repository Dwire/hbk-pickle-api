import { notificationQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { registrationCloseWarningMinutes, sessionStartWarningMinutes } from '../../shared/constants.js'
import { SessionService } from '../../features/sessions/sessionService.js'
import { SubSelectionService } from '../../features/subs/subSelectionService.js'

type QueuePayload = {
  notificationId: string
  deviceTokens: string[]
}

export class RegistrationScheduler {
  private sessionService = new SessionService()
  private subSelectionService = new SubSelectionService()

  public async queueRegistrationCloseWarnings(now: Date): Promise<void> {
    const upcoming = await prisma.sessionOccurrence.findMany({
      where: {
        startsAt: { gte: now }
      }
    })

    for (const occurrence of upcoming) {
      const closeWarningAt = new Date(occurrence.startsAt)
      closeWarningAt.setDate(closeWarningAt.getDate() - 1)
      closeWarningAt.setHours(21, -registrationCloseWarningMinutes, 0, 0)

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
      const warningAt = new Date(occurrence.startsAt)
      warningAt.setMinutes(warningAt.getMinutes() - sessionStartWarningMinutes)

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
    const upcoming = await prisma.sessionOccurrence.findMany({
      where: {
        startsAt: { gte: now }
      },
      include: { session: true }
    })

    for (const occurrence of upcoming) {
      const { registrationCloseAt } = this.sessionService.calculateRegistrationWindow(occurrence.startsAt)

      if (registrationCloseAt > now) {
        continue
      }

      const result = await this.subSelectionService.runSelection(occurrence.id)
      await this.queueSubSelectionNotifications(occurrence.id, result)
    }

    logger.info('Queued sub selection notifications')
  }

  private async queueSubSelectionNotifications(
    occurrenceId: string,
    result: { selectedIds: string[]; replacedIds: string[]; stillActiveIds: string[] }
  ): Promise<void> {
    if (result.selectedIds.length === 0 && result.replacedIds.length === 0) {
      return
    }

    const selectedSignups = result.selectedIds.length
      ? await prisma.subSignup.findMany({
          where: { id: { in: result.selectedIds } },
          include: { user: { include: { devices: true } } }
        })
      : []

    for (const signup of selectedSignups) {
      const notification = await prisma.notification.create({
        data: {
          userId: signup.userId,
          occurrenceId,
          title: 'You made the sub list',
          body: 'You have been selected as a sub for this session.',
          channel: 'PUSH',
          status: 'PENDING',
          kind: 'SUB_SELECTED',
          payload: { subSignupId: signup.id }
        }
      })

      const deviceTokens = signup.user.devices.map((device) => device.token)

      if (deviceTokens.length === 0) {
        continue
      }

      await notificationQueue.add('sub-selected', {
        notificationId: notification.id,
        deviceTokens
      } as QueuePayload)
    }

    if (result.replacedIds.length === 0) {
      return
    }

    const replacedSignups = await prisma.subSignup.findMany({
      where: { id: { in: result.replacedIds } },
      include: { user: { include: { devices: true } } }
    })

    for (const signup of replacedSignups) {
      const notification = await prisma.notification.create({
        data: {
          userId: signup.userId,
          occurrenceId,
          title: 'Sub status updated',
          body: 'You are no longer selected as a sub for this session.',
          channel: 'PUSH',
          status: 'PENDING',
          kind: 'SUB_STATUS_CHANGED',
          payload: { subSignupId: signup.id }
        }
      })

      const deviceTokens = signup.user.devices.map((device) => device.token)

      if (deviceTokens.length === 0) {
        continue
      }

      await notificationQueue.add('sub-status-changed', {
        notificationId: notification.id,
        deviceTokens
      } as QueuePayload)
    }
  }
}
