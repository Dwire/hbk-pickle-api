import type { Job } from 'bullmq'
import { Worker } from 'bullmq'

import type { NotificationKind } from '../generated/prisma/client.js'
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

const subSelectedNotificationKind: NotificationKind = 'SUB_SELECTED'
const subStatusChangedNotificationKind: NotificationKind = 'SUB_STATUS_CHANGED'
const pendingStatus = 'PENDING'
const subSelectedJobName = 'sub-selected'
const subStatusChangedJobName = 'sub-status-changed'
const subNotificationJobIdPrefix = 'sub-notify'
const subNotificationJobIdSeparator = '-'
const sessionOccurrenceStatusCanceled = 'CANCELED'

const pendingSubSelectionKinds: NotificationKind[] = [subSelectedNotificationKind, subStatusChangedNotificationKind]

const subSelectionService = new SubSelectionService()
const sessionService = new SessionService()
const workerName = subSelectionQueue.name

const queuePendingSubSelectionNotifications = async (
  occurrenceId: string
): Promise<{ queuedCount: number; pendingCount: number; skippedNoDeviceCount: number }> => {
  const pendingNotifications = await prisma.notification.findMany({
    where: {
      occurrenceId,
      status: pendingStatus,
      kind: { in: pendingSubSelectionKinds }
    }
  })

  const userIds = [...new Set(pendingNotifications.map((notification) => notification.userId))]
  const devices = await prisma.userDevice.findMany({
    where: {
      userId: { in: userIds }
    }
  })
  const deviceTokensByUserId = new Map<string, string[]>()
  for (const device of devices) {
    const existingTokens = deviceTokensByUserId.get(device.userId) ?? []
    existingTokens.push(device.token)
    deviceTokensByUserId.set(device.userId, existingTokens)
  }

  let queuedCount = 0
  let skippedNoDeviceCount = 0

  for (const notification of pendingNotifications) {
    const deviceTokens = deviceTokensByUserId.get(notification.userId) ?? []
    if (deviceTokens.length === 0) {
      skippedNoDeviceCount += 1
      continue
    }

    const queueJobName =
      notification.kind === subSelectedNotificationKind ? subSelectedJobName : subStatusChangedJobName

    await notificationQueue.add(
      queueJobName,
      {
        notificationId: notification.id,
        deviceTokens
      } as NotificationQueuePayload,
      {
        jobId: `${subNotificationJobIdPrefix}${subNotificationJobIdSeparator}${notification.id}`,
        removeOnComplete: true,
        removeOnFail: true
      }
    )

    queuedCount += 1
  }

  return {
    queuedCount,
    pendingCount: pendingNotifications.length,
    skippedNoDeviceCount
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

    if (occurrence.status === sessionOccurrenceStatusCanceled) {
      logger.info({ occurrenceId, jobId: job.id }, 'Sub selection skipped: occurrence canceled')
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
    const queuedNotificationResult = await queuePendingSubSelectionNotifications(occurrenceId)

    logger.info(
      {
        occurrenceId,
        jobId: job.id,
        newlySelectedCount: result.newlySelectedIds.length,
        replacedCount: result.replacedIds.length,
        pendingNotificationCount: queuedNotificationResult.pendingCount,
        queuedNotificationCount: queuedNotificationResult.queuedCount,
        skippedNoDeviceNotificationCount: queuedNotificationResult.skippedNoDeviceCount
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
