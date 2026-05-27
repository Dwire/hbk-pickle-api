import type { NotificationKind } from '../../generated/prisma/client.js'
import { notificationQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'

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

const pendingSubSelectionKinds: NotificationKind[] = [
  subSelectedNotificationKind,
  subStatusChangedNotificationKind
]

export const queuePendingSubSelectionNotifications = async (
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
      notification.kind === subSelectedNotificationKind
        ? subSelectedJobName
        : subStatusChangedJobName

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
