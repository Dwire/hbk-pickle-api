import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { calculateSessionDurationMinutes } from '../../shared/attendanceCoverage.js'
import { SessionService } from '../sessions/sessionService.js'

import { computeSubSelection } from './subSelectionEngine.js'

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
        registrations: {
          where: { status: 'ATTENDING' },
          orderBy: { createdAt: 'asc' }
        },
        subSignups: { orderBy: { signedUpAt: 'asc' } }
      }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const sessionDurationMinutes = calculateSessionDurationMinutes(
      occurrence.startsAt,
      occurrence.endsAt
    )

    if (sessionDurationMinutes <= 0) {
      return {
        newlySelectedIds: [],
        replacedIds: [],
        stillActiveIds: []
      }
    }

    const sessionService = new SessionService()
    const { registrationCloseAt } = sessionService.calculateRegistrationWindow(occurrence.startsAt)
    const now = new Date()
    const isRegistrationClosed = now >= registrationCloseAt

    const activeSignups = occurrence.subSignups.filter(
      (signup) => signup.status === 'ACTIVE' || signup.status === 'SELECTED'
    )
    const activeSignupById = new Map(
      activeSignups.map((signup) => [signup.id, signup])
    )
    const selection = computeSubSelection({
      sessionDurationMinutes,
      sessionCapacity: occurrence.session.capacity ?? 0,
      registrationClosed: isRegistrationClosed,
      registrations: occurrence.registrations.map((registration) => ({
        id: registration.id,
        createdAt: registration.createdAt,
        playMode: registration.playMode,
        playSegmentSide: registration.playSegmentSide,
        playMinutes: registration.playMinutes
      })),
      signups: activeSignups.map((signup) => ({
        id: signup.id,
        userId: signup.userId,
        status: signup.status === 'SELECTED' ? 'SELECTED' : 'ACTIVE',
        availabilityMode: signup.availabilityMode,
        availabilitySegmentSide: signup.availabilitySegmentSide,
        availabilityMinutes: signup.availabilityMinutes,
        partialLocked: signup.partialLocked,
        signedUpAt: signup.signedUpAt,
        selectionType: signup.selectionType,
        assignedStartOffsetMinutes: signup.assignedStartOffsetMinutes,
        assignedEndOffsetMinutes: signup.assignedEndOffsetMinutes
      }))
    })

    const subSignupById = new Map(activeSignups.map((signup) => [signup.id, signup]))
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

    for (const subSignupId of selection.newlySelectedIds) {
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

    for (const subSignupId of selection.deselectedIds) {
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
      for (const signup of selection.activeSignups) {
        const signupRecord = activeSignupById.get(signup.id)
        if (!signupRecord) {
          continue
        }

        const assignment = selection.assignmentsBySignupId.get(signup.id)
        if (!assignment) {
          await tx.subSignup.update({
            where: { id: signup.id },
            data: {
              status: 'ACTIVE',
              selectedAt: null,
              selectionType: null,
              assignedStartOffsetMinutes: null,
              assignedEndOffsetMinutes: null,
              partialLocked: false,
              partialLockedAt: null
            }
          })
          continue
        }

        const isFullSelection = assignment.selectionType === 'FULL'
        await tx.subSignup.update({
          where: { id: signup.id },
          data: {
            status: 'SELECTED',
            selectedAt: signupRecord.selectedAt ?? selectedAt,
            selectionType: assignment.selectionType,
            assignedStartOffsetMinutes: assignment.segment.startOffsetMinutes,
            assignedEndOffsetMinutes: assignment.segment.endOffsetMinutes,
            partialLocked: isFullSelection ? false : signupRecord.partialLocked,
            partialLockedAt: isFullSelection ? null : signupRecord.partialLockedAt
          }
        })
      }

      for (let index = 0; index < selection.activeSignups.length; index += 1) {
        await tx.subSignup.update({
          where: { id: selection.activeSignups[index].id },
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
        registrationClosed: isRegistrationClosed,
        fullSlotsInitiallyOpen: selection.initialFullSlots,
        pairedPartialCount: selection.pairedPartialCount,
        remainingFullSlots: selection.remainingFullSlots,
        remainingPartialSlotCount: selection.remainingPartialSlotCount,
        selectedCount: selection.assignmentsBySignupId.size,
        newlySelectedCount: selection.newlySelectedIds.length,
        deselectedCount: selection.deselectedIds.length,
        subSelectedNotificationCount: subSelectedNotifications.length,
        subStatusChangedNotificationCount: subStatusChangedNotifications.length
      },
      'Sub selection completed'
    )

    return {
      newlySelectedIds: selection.newlySelectedIds,
      replacedIds: selection.deselectedIds,
      stillActiveIds: selection.stillActiveIds
    }
  }
}
