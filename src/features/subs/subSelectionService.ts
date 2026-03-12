import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'

type SelectionResult = {
  newlySelectedIds: string[]
  replacedIds: string[]
  stillActiveIds: string[]
}

const subSelectedNotificationTitle = 'You made the sub list'
const subSelectedNotificationBody = 'You have been selected as a sub for this session.'
const subSelectedNotificationKind = 'SUB_SELECTED'
const subStatusChangedNotificationTitle = 'Sub status updated'
const subStatusChangedNotificationBody = 'You are no longer selected as a sub for this session.'
const subStatusChangedNotificationKind = 'SUB_STATUS_CHANGED'
const pushChannel = 'PUSH'
const pendingStatus = 'PENDING'

export class SubSelectionService {
  public async runSelection(occurrenceId: string): Promise<SelectionResult> {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        session: true,
        registrations: { where: { status: 'ATTENDING' } },
        subSignups: { orderBy: { createdAt: 'asc' } }
      }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const capacity = occurrence.session.capacity ?? 0
    const attendingCount = occurrence.registrations.length
    const openSlots = Math.max(capacity - attendingCount, 0)

    const activeSignups = occurrence.subSignups.filter((signup) => signup.status === 'ACTIVE' || signup.status === 'SELECTED')
    const selected = activeSignups.slice(0, openSlots)
    const overflow = activeSignups.slice(openSlots)

    const selectedIds = selected.map((signup) => signup.id)
    const overflowIds = overflow.map((signup) => signup.id)

    const previouslySelectedIds = occurrence.subSignups.filter((signup) => signup.status === 'SELECTED').map((signup) => signup.id)
    const previouslySelectedIdSet = new Set(previouslySelectedIds)
    const replacedIds = previouslySelectedIds.filter((id) => !selectedIds.includes(id))
    const newlySelectedIds = selectedIds.filter((id) => !previouslySelectedIdSet.has(id))
    const subSignupById = new Map(occurrence.subSignups.map((signup) => [signup.id, signup]))
    const subSelectedNotifications: {
      userId: string
      occurrenceId: string
      title: string
      body: string
      channel: 'PUSH'
      status: 'PENDING'
      kind: 'SUB_SELECTED'
      payload: { subSignupId: string }
    }[] = []
    const subStatusChangedNotifications: {
      userId: string
      occurrenceId: string
      title: string
      body: string
      channel: 'PUSH'
      status: 'PENDING'
      kind: 'SUB_STATUS_CHANGED'
      payload: { subSignupId: string }
    }[] = []

    for (const subSignupId of newlySelectedIds) {
      const signup = subSignupById.get(subSignupId)
      if (!signup) {
        continue
      }

      subSelectedNotifications.push({
        userId: signup.userId,
        occurrenceId,
        title: subSelectedNotificationTitle,
        body: subSelectedNotificationBody,
        channel: pushChannel,
        status: pendingStatus,
        kind: subSelectedNotificationKind,
        payload: { subSignupId }
      })
    }

    for (const subSignupId of replacedIds) {
      const signup = subSignupById.get(subSignupId)
      if (!signup) {
        continue
      }

      subStatusChangedNotifications.push({
        userId: signup.userId,
        occurrenceId,
        title: subStatusChangedNotificationTitle,
        body: subStatusChangedNotificationBody,
        channel: pushChannel,
        status: pendingStatus,
        kind: subStatusChangedNotificationKind,
        payload: { subSignupId }
      })
    }

    const selectedAt = new Date()

    await prisma.$transaction(async (tx) => {
      if (newlySelectedIds.length > 0) {
        await tx.subSignup.updateMany({
          where: { id: { in: newlySelectedIds } },
          data: {
            status: 'SELECTED',
            selectedAt
          }
        })
      }

      if (overflowIds.length > 0) {
        await tx.subSignup.updateMany({
          where: { id: { in: overflowIds }, status: 'SELECTED' },
          data: {
            status: 'ACTIVE',
            selectedAt: null
          }
        })
      }

      if (replacedIds.length > 0) {
        await tx.subSignup.updateMany({
          where: { id: { in: replacedIds } },
          data: {
            status: 'REPLACED'
          }
        })
      }

      for (let index = 0; index < activeSignups.length; index += 1) {
        await tx.subSignup.update({
          where: { id: activeSignups[index].id },
          data: { selectionRank: index + 1 }
        })
      }

      if (subSelectedNotifications.length > 0) {
        await tx.notification.createMany({
          data: subSelectedNotifications
        })
      }

      if (subStatusChangedNotifications.length > 0) {
        await tx.notification.createMany({
          data: subStatusChangedNotifications
        })
      }
    })

    logger.info(
      {
        occurrenceId,
        openSlots,
        selectedCount: selectedIds.length,
        newlySelectedCount: newlySelectedIds.length,
        replacedCount: replacedIds.length,
        subSelectedNotificationCount: subSelectedNotifications.length,
        subStatusChangedNotificationCount: subStatusChangedNotifications.length
      },
      'Sub selection completed'
    )

    return {
      newlySelectedIds,
      replacedIds,
      stillActiveIds: overflowIds
    }
  }
}
