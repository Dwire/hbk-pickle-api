import type { Job } from 'bullmq'
import { Worker } from 'bullmq'

import { firebaseMessaging } from '../integrations/firebase/firebaseClient.js'
import { notificationQueue } from '../integrations/bull/queue.js'
import { logger } from '../shared/logger.js'
import { prisma } from '../shared/prisma.js'

type NotificationJob = {
  notificationId: string
  deviceTokens: string[]
}

const workerName = notificationQueue.name

export const notificationWorker = new Worker<NotificationJob>(
  workerName,
  async (job: Job<NotificationJob>) => {
    const { notificationId, deviceTokens } = job.data

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId }
    })

    if (!notification) {
      logger.warn({ notificationId }, 'Notification missing')
      return
    }

    const response = await firebaseMessaging.sendEachForMulticast({
      tokens: deviceTokens,
      notification: {
        title: notification.title,
        body: notification.body
      }
    })

    if (response.failureCount > 0) {
      logger.warn({ notificationId, failureCount: response.failureCount }, 'Some notifications failed')
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: response.failureCount > 0 ? 'FAILED' : 'SENT' }
    })
  },
  {
    connection: {
      url: process.env.REDIS_URL ?? ''
    }
  }
)

notificationWorker.on('failed', (job: Job<NotificationJob> | undefined, error: Error) => {
  logger.error({ jobId: job?.id, error }, 'Notification job failed')
})
