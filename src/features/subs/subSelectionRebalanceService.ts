import type { SessionOccurrenceStatus } from '../../generated/prisma/client.js'
import { logger } from '../../shared/logger.js'
import { SessionService } from '../sessions/sessionService.js'

import { queuePendingSubSelectionNotifications } from './subSelectionNotificationQueue.js'
import { SubSelectionService } from './subSelectionService.js'

const occurrenceStatusActive: SessionOccurrenceStatus = 'ACTIVE'

export const shouldRebalanceSubSelection = (
  occurrence: { startsAt: Date; endsAt: Date; status: SessionOccurrenceStatus },
  now: Date = new Date()
): boolean => {
  if (occurrence.status !== occurrenceStatusActive) {
    return false
  }

  if (now >= occurrence.endsAt) {
    return false
  }

  const sessionService = new SessionService()
  const { registrationCloseAt } = sessionService.calculateRegistrationWindow(occurrence.startsAt)
  return now >= registrationCloseAt
}

export const rebalanceSubSelection = async (occurrenceId: string): Promise<void> => {
  const subSelectionService = new SubSelectionService()
  const selectionResult = await subSelectionService.runSelection(occurrenceId)
  const queuedNotificationResult = await queuePendingSubSelectionNotifications(occurrenceId)

  logger.info(
    {
      occurrenceId,
      newlySelectedCount: selectionResult.newlySelectedIds.length,
      deselectedCount: selectionResult.replacedIds.length,
      queuedNotificationCount: queuedNotificationResult.queuedCount,
      pendingNotificationCount: queuedNotificationResult.pendingCount,
      skippedNoDeviceNotificationCount: queuedNotificationResult.skippedNoDeviceCount
    },
    'Triggered immediate sub selection rebalance'
  )
}
