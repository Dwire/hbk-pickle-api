import type { Job } from 'bullmq'
import { Worker } from 'bullmq'

import { SessionService } from '../features/sessions/sessionService.js'
import { SubSelectionService } from '../features/subs/subSelectionService.js'
import { notificationQueue, subSelectionQueue } from '../integrations/bull/queue.js'
import { prisma } from '../shared/prisma.js'
import { logger } from '../shared/logger.js'
import { config } from '../shared/config.js'

type SubSelectionJobPayload = {
  occurrenceId: string
}

type NotificationQueuePayload = {
  notificationId: string
  deviceTokens: string[]
}

const subSelectedNotificationTitle = 'You made the sub list'
const subSelectedNotificationBody = 'You have been selected as a sub for this session.'
const subSelectedNotificationKind = 'SUB_SELECTED'
const subStatusChangedNotificationTitle = 'Sub status updated'
const subStatusChangedNotificationBody = 'You are no longer selected as a sub for this session.'
const subStatusChangedNotificationKind = 'SUB_STATUS_CHANGED'
const pushChannel = 'PUSH'
const pendingStatus = 'PENDING'
const subSelectedJobName = 'sub-selected'
const subStatusChangedJobName = 'sub-status-changed'

const subSelectionService = new SubSelectionService()
const sessionService = new SessionService()
const workerName = subSelectionQueue.name

const queueSubSelectedNotifications = async (occurrenceId: string, subSignupIds: string[]): Promise<void> => {
  if (subSignupIds.length === 0) {
    return
  }

  const selectedSignups = await prisma.subSignup.findMany({
    where: { id: { in: subSignupIds } },
    include: { user: { include: { devices: true } } }
  })

  for (const signup of selectedSignups) {
    const notification = await prisma.notification.create({
      data: {
        userId: signup.userId,
        occurrenceId,
        title: subSelectedNotificationTitle,
        body: subSelectedNotificationBody,
        channel: pushChannel,
        status: pendingStatus,
        kind: subSelectedNotificationKind,
        payload: { subSignupId: signup.id }
      }
    })

    const deviceTokens = signup.user.devices.map((device) => device.token)
    if (deviceTokens.length === 0) {
      continue
    }

    await notificationQueue.add(subSelectedJobName, {
      notificationId: notification.id,
      deviceTokens
    } as NotificationQueuePayload)
  }
}

const queueSubStatusChangedNotifications = async (occurrenceId: string, subSignupIds: string[]): Promise<void> => {
  if (subSignupIds.length === 0) {
    return
  }

  const replacedSignups = await prisma.subSignup.findMany({
    where: { id: { in: subSignupIds } },
    include: { user: { include: { devices: true } } }
  })

  for (const signup of replacedSignups) {
    const notification = await prisma.notification.create({
      data: {
        userId: signup.userId,
        occurrenceId,
        title: subStatusChangedNotificationTitle,
        body: subStatusChangedNotificationBody,
        channel: pushChannel,
        status: pendingStatus,
        kind: subStatusChangedNotificationKind,
        payload: { subSignupId: signup.id }
      }
    })

    const deviceTokens = signup.user.devices.map((device) => device.token)
    if (deviceTokens.length === 0) {
      continue
    }

    await notificationQueue.add(subStatusChangedJobName, {
      notificationId: notification.id,
      deviceTokens
    } as NotificationQueuePayload)
  }
}

export const subSelectionWorker = new Worker<SubSelectionJobPayload>(
  workerName,
  async (job: Job<SubSelectionJobPayload>) => {
    const { occurrenceId } = job.data
    const now = new Date()

    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId }
    })

    if (!occurrence) {
      logger.warn({ occurrenceId, jobId: job.id }, 'Sub selection skipped: occurrence missing')
      return
    }

    const { registrationCloseAt } = sessionService.calculateRegistrationWindow(occurrence.startsAt)
    if (registrationCloseAt > now) {
      logger.info({ occurrenceId, jobId: job.id, registrationCloseAt, now }, 'Sub selection skipped: registration not closed')
      return
    }

    if (occurrence.endsAt <= now) {
      logger.info({ occurrenceId, jobId: job.id, endsAt: occurrence.endsAt, now }, 'Sub selection skipped: occurrence ended')
      return
    }

    const result = await subSelectionService.runSelection(occurrenceId)

    if (result.newlySelectedIds.length === 0 && result.replacedIds.length === 0) {
      logger.info({ occurrenceId, jobId: job.id }, 'Sub selection job made no notification changes')
      return
    }

    await queueSubSelectedNotifications(occurrenceId, result.newlySelectedIds)
    await queueSubStatusChangedNotifications(occurrenceId, result.replacedIds)

    logger.info(
      {
        occurrenceId,
        jobId: job.id,
        newlySelectedCount: result.newlySelectedIds.length,
        replacedCount: result.replacedIds.length
      },
      'Sub selection job completed'
    )
  },
  {
    connection: {
      url: config.redisUrl
    }
  }
)

subSelectionWorker.on('failed', (job: Job<SubSelectionJobPayload> | undefined, error: Error) => {
  logger.error({ jobId: job?.id, error }, 'Sub selection job failed')
})
