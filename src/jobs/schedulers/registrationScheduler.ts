import { notificationQueue, subSelectionQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { registrationCloseWarningMinutes, sessionStartWarningMinutes } from '../../shared/constants.js'
import { SessionService } from '../../features/sessions/sessionService.js'
import { ProfilePhotoService } from '../../features/profilePhoto/profilePhotoService.js'
import { getEasternRegistrationCloseWarningAt } from '../../shared/time.js'
import { Prisma } from '../../generated/prisma/client.js'
import type { NotificationKind } from '../../generated/prisma/client.js'

import { DemoOrgAutofillService } from './demoOrgAutofillService.js'

type QueuePayload = {
  notificationId: string
  deviceTokens: string[]
}

type SubSelectionQueuePayload = {
  occurrenceId: string
}

const subSelectionJobName = 'sub-selection'
const subSelectionJobIdPrefix = 'sub-selection'
const subSelectionJobIdSeparator = '-'
const subSelectionJobAttempts = 3
const subSelectionJobBackoffDelayMs = 1_000
const sessionOccurrenceStatusActive = 'ACTIVE'
const registrationStatusAttending = 'ATTENDING'
const notificationChannelPush = 'PUSH'
const notificationStatusPending = 'PENDING'
const registrationCloseWarningKind: NotificationKind = 'REGISTRATION_CLOSE_WARNING'
const sessionStartWarningKind: NotificationKind = 'SESSION_START_WARNING'
const registrationCloseWarningJobName = 'registration-close-warning'
const sessionStartWarningJobName = 'session-start-warning'
const reminderJobIdPrefix = 'reminder-notify'
const reminderJobIdSeparator = '-'
const millisecondsPerMinute = 60_000
const uniqueConstraintErrorCode = 'P2002'
const notificationStatusSent = 'SENT'
const notificationStatusFailed = 'FAILED'

type ReminderDefinition = {
  queueJobName: string
  kind: NotificationKind
  title: string
  body: string
  getWarningAt: (startsAt: Date) => Date
}

const buildReminderKey = (
  userId: string,
  occurrenceId: string
): string => `${userId}${reminderJobIdSeparator}${occurrenceId}`

const buildReminderQueueJobId = (notificationId: string): string =>
  `${reminderJobIdPrefix}${reminderJobIdSeparator}${notificationId}`

type ExistingReminderNotification = {
  id: string
  userId: string
  occurrenceId: string
  status: string
}

const registrationCloseReminder: ReminderDefinition = {
  queueJobName: registrationCloseWarningJobName,
  kind: registrationCloseWarningKind,
  title: 'Registration closes soon',
  body: `Registration closes in ${registrationCloseWarningMinutes} minutes.`,
  getWarningAt: (startsAt: Date) =>
    getEasternRegistrationCloseWarningAt(
      startsAt,
      registrationCloseWarningMinutes
    )
}

const sessionStartReminder: ReminderDefinition = {
  queueJobName: sessionStartWarningJobName,
  kind: sessionStartWarningKind,
  title: 'Session starting soon',
  body: `Your session starts in ${sessionStartWarningMinutes} minutes.`,
  getWarningAt: (startsAt: Date) =>
    new Date(
      startsAt.getTime() -
        sessionStartWarningMinutes * millisecondsPerMinute
    )
}

export class RegistrationScheduler {
  private sessionService = new SessionService()
  private profilePhotoService = new ProfilePhotoService()
  private demoOrgAutofillService = new DemoOrgAutofillService()

  public async queueRegistrationCloseWarnings(now: Date): Promise<void> {
    await this.queueWarnings(now, registrationCloseReminder)
  }

  public async queueSessionStartWarnings(now: Date): Promise<void> {
    await this.queueWarnings(now, sessionStartReminder)
  }

  public async runDemoOrgAutofill(now: Date): Promise<void> {
    await this.demoOrgAutofillService.runDemoOrgAutofillTick(now)
  }

  private async queueWarnings(
    now: Date,
    reminder: ReminderDefinition
  ): Promise<void> {
    const upcomingOccurrences = await prisma.sessionOccurrence.findMany({
      where: {
        status: sessionOccurrenceStatusActive,
        startsAt: { gte: now }
      },
      select: {
        id: true,
        startsAt: true
      }
    })
    const dueOccurrenceIds = upcomingOccurrences
      .filter((occurrence) => reminder.getWarningAt(occurrence.startsAt) <= now)
      .map((occurrence) => occurrence.id)

    if (dueOccurrenceIds.length === 0) {
      logger.info(
        { reminderKind: reminder.kind, dueOccurrenceCount: 0 },
        'Queued reminder notifications'
      )
      return
    }

    const attendees = await prisma.sessionRegistration.findMany({
      where: {
        occurrenceId: { in: dueOccurrenceIds },
        status: registrationStatusAttending
      },
      select: {
        occurrenceId: true,
        userId: true
      }
    })

    if (attendees.length === 0) {
      logger.info(
        { reminderKind: reminder.kind, dueOccurrenceCount: dueOccurrenceIds.length, attendeeCount: 0 },
        'Queued reminder notifications'
      )
      return
    }

    const userIds = Array.from(new Set(attendees.map((attendee) => attendee.userId)))
    const [existingNotifications, devices] = await Promise.all([
      prisma.notification.findMany({
        where: {
          occurrenceId: { in: dueOccurrenceIds },
          userId: { in: userIds },
          kind: reminder.kind
        },
        select: {
          id: true,
          userId: true,
          occurrenceId: true,
          status: true
        }
      }),
      prisma.userDevice.findMany({
        where: {
          userId: { in: userIds }
        },
        select: {
          userId: true,
          token: true
        }
      })
    ])
    const existingReminderByKey = new Map<string, ExistingReminderNotification>()
    for (const notification of existingNotifications) {
      if (!notification.occurrenceId) {
        continue
      }

      const reminderKey = buildReminderKey(notification.userId, notification.occurrenceId)
      existingReminderByKey.set(reminderKey, {
        id: notification.id,
        userId: notification.userId,
        occurrenceId: notification.occurrenceId,
        status: notification.status
      })
    }
    const deviceTokensByUserId = new Map<string, string[]>()
    for (const device of devices) {
      const existingTokens = deviceTokensByUserId.get(device.userId) ?? []
      existingTokens.push(device.token)
      deviceTokensByUserId.set(device.userId, existingTokens)
    }

    let queuedCount = 0
    let existingReminderCount = 0
    let skippedNoDeviceCount = 0
    let reusedPendingReminderCount = 0
    let skippedExistingJobCount = 0

    for (const attendee of attendees) {
      const reminderKey = buildReminderKey(attendee.userId, attendee.occurrenceId)
      const existingReminder = existingReminderByKey.get(reminderKey)
      if (
        existingReminder &&
        (existingReminder.status === notificationStatusSent ||
          existingReminder.status === notificationStatusFailed)
      ) {
        existingReminderCount += 1
        continue
      }

      const deviceTokens = deviceTokensByUserId.get(attendee.userId) ?? []
      if (deviceTokens.length === 0) {
        skippedNoDeviceCount += 1
        continue
      }

      let notificationId = existingReminder?.id ?? ''
      if (existingReminder) {
        reusedPendingReminderCount += 1
      } else {
        try {
          const notification = await prisma.notification.create({
            data: {
              userId: attendee.userId,
              occurrenceId: attendee.occurrenceId,
              title: reminder.title,
              body: reminder.body,
              channel: notificationChannelPush,
              status: notificationStatusPending,
              kind: reminder.kind
            },
            select: {
              id: true
            }
          })
          notificationId = notification.id
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === uniqueConstraintErrorCode
          ) {
            const existingNotification = await prisma.notification.findFirst({
              where: {
                userId: attendee.userId,
                occurrenceId: attendee.occurrenceId,
                kind: reminder.kind
              },
              select: {
                id: true,
                status: true
              }
            })

            if (!existingNotification) {
              throw error
            }

            if (
              existingNotification.status === notificationStatusSent ||
              existingNotification.status === notificationStatusFailed
            ) {
              existingReminderCount += 1
              continue
            }

            notificationId = existingNotification.id
            reusedPendingReminderCount += 1
          } else {
            throw error
          }
        }
      }

      const queueJobId = buildReminderQueueJobId(notificationId)
      const existingJob = await notificationQueue.getJob(queueJobId)
      if (existingJob) {
        skippedExistingJobCount += 1
        continue
      }

      await notificationQueue.add(
        reminder.queueJobName,
        {
          notificationId,
          deviceTokens
        } as QueuePayload,
        {
          jobId: queueJobId,
          removeOnComplete: true,
          removeOnFail: true
        }
      )
      queuedCount += 1
    }

    logger.info(
      {
        reminderKind: reminder.kind,
        dueOccurrenceCount: dueOccurrenceIds.length,
        attendeeCount: attendees.length,
        queuedCount,
        existingReminderCount,
        skippedNoDeviceCount,
        reusedPendingReminderCount,
        skippedExistingJobCount
      },
      'Queued reminder notifications'
    )
  }

  public async queueSubSelection(now: Date): Promise<void> {
    const activeOccurrences = await prisma.sessionOccurrence.findMany({
      where: {
        status: sessionOccurrenceStatusActive,
        endsAt: { gt: now }
      }
    })

    let queuedCount = 0
    let skippedExistingCount = 0

    for (const occurrence of activeOccurrences) {
      const { registrationCloseAt } = this.sessionService.calculateRegistrationWindow(occurrence.startsAt)

      if (registrationCloseAt > now) {
        continue
      }

      const jobId = `${subSelectionJobIdPrefix}${subSelectionJobIdSeparator}${occurrence.id}`
      const existingJob = await subSelectionQueue.getJob(jobId)

      if (existingJob) {
        skippedExistingCount += 1
        continue
      }

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
          removeOnComplete: true,
          removeOnFail: true
        }
      )

      queuedCount += 1
    }

    logger.info({ queuedCount, skippedExistingCount }, 'Queued sub selection jobs')
  }

  public async cleanupStaleProfilePhotoUploadIntents(now: Date): Promise<void> {
    const cleanupSummary = await this.profilePhotoService.cleanupStaleUploadIntents(
      now
    )

    logger.info(
      {
        staleIntentCount: cleanupSummary.staleIntentCount,
        deletedIntentCount: cleanupSummary.deletedIntentCount,
        attemptedCloudflareDeleteCount:
          cleanupSummary.attemptedCloudflareDeleteCount,
        cloudflareDeleteFailureCount:
          cleanupSummary.cloudflareDeleteFailureCount
      },
      'Cleaned stale profile photo upload intents'
    )
  }
}
