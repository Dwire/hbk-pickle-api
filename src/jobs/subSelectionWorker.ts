import type { Job } from 'bullmq'
import { Worker } from 'bullmq'

import { SessionService } from '../features/sessions/sessionService.js'
import { queuePendingSubSelectionNotifications } from '../features/subs/subSelectionNotificationQueue.js'
import { SubSelectionService } from '../features/subs/subSelectionService.js'
import { subSelectionQueue } from '../integrations/bull/queue.js'
import { prisma } from '../shared/prisma.js'
import { logger } from '../shared/logger.js'
import { config } from '../shared/config.js'

type SubSelectionJobPayload = {
  occurrenceId: string
}

const sessionOccurrenceStatusCanceled = 'CANCELED'

const subSelectionService = new SubSelectionService()
const sessionService = new SessionService()
const workerName = subSelectionQueue.name

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
