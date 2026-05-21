import type { PlaySegmentSide, RegistrationPlayMode, SubSelectionType } from '../../generated/prisma/client.js'
import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'
import { SessionService } from '../sessions/sessionService.js'

type SelectionResult = {
  newlySelectedIds: string[]
  replacedIds: string[]
  stillActiveIds: string[]
}

type TimeSegment = {
  startOffsetMinutes: number
  endOffsetMinutes: number
}

type PartialSlot = {
  targetRegistrationId: string
  side: PlaySegmentSide
  minutes: number
  segment: TimeSegment
}

type NormalizedRegistration = {
  id: string
  createdAt: Date
  ownSegment: TimeSegment
  ownMinutes: number
  gap: PartialSlot | null
  fillTargetRegistrationId: string | null
}

type SelectionAssignment = {
  selectionType: SubSelectionType
  segment: TimeSegment
}

const subSelectedNotificationTitle = 'You made the sub list'
const subSelectedNotificationBody = 'You have been selected as a sub for this session.'
const subSelectedNotificationKind = 'SUB_SELECTED'
const subStatusChangedNotificationTitle = 'Sub status updated'
const subStatusChangedNotificationBody = 'You are no longer selected as a sub for this session.'
const subStatusChangedNotificationKind = 'SUB_STATUS_CHANGED'
const pushChannel = 'PUSH'
const pendingStatus = 'PENDING'
const millisecondsPerMinute = 60_000
const minutesPerBlock = 30

const isThirtyMinuteBlock = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value % minutesPerBlock === 0

const segmentsOverlap = (left: TimeSegment, right: TimeSegment): boolean =>
  left.startOffsetMinutes < right.endOffsetMinutes && right.startOffsetMinutes < left.endOffsetMinutes

const buildSegment = (
  mode: RegistrationPlayMode,
  side: PlaySegmentSide | null,
  minutes: number | null,
  sessionDurationMinutes: number
): TimeSegment => {
  const validPartial =
    mode === 'PARTIAL' &&
    side !== null &&
    minutes !== null &&
    isThirtyMinuteBlock(minutes) &&
    minutes < sessionDurationMinutes

  if (!validPartial) {
    return {
      startOffsetMinutes: 0,
      endOffsetMinutes: sessionDurationMinutes
    }
  }

  if (side === 'START') {
    return {
      startOffsetMinutes: 0,
      endOffsetMinutes: minutes
    }
  }

  return {
    startOffsetMinutes: sessionDurationMinutes - minutes,
    endOffsetMinutes: sessionDurationMinutes
  }
}

const buildGapSlot = (
  registration: {
    id: string
    playMode: RegistrationPlayMode
    playSegmentSide: PlaySegmentSide | null
    playMinutes: number | null
  },
  sessionDurationMinutes: number
): PartialSlot | null => {
  const isValidPartial =
    registration.playMode === 'PARTIAL' &&
    registration.playSegmentSide !== null &&
    registration.playMinutes !== null &&
    isThirtyMinuteBlock(registration.playMinutes) &&
    registration.playMinutes < sessionDurationMinutes

  if (!isValidPartial) {
    return null
  }

  const playMinutes = registration.playMinutes as number
  const gapMinutes = sessionDurationMinutes - playMinutes
  if (gapMinutes <= 0) {
    return null
  }

  if (registration.playSegmentSide === 'START') {
    return {
      targetRegistrationId: registration.id,
      side: 'END',
      minutes: gapMinutes,
      segment: {
        startOffsetMinutes: playMinutes,
        endOffsetMinutes: sessionDurationMinutes
      }
    }
  }

  return {
    targetRegistrationId: registration.id,
    side: 'START',
    minutes: gapMinutes,
    segment: {
      startOffsetMinutes: 0,
      endOffsetMinutes: gapMinutes
    }
  }
}

const matchesPartialPreference = (
  signup: {
    availabilityMode: 'FULL_ONLY' | 'FLEX' | 'PARTIAL_ONLY'
    availabilitySegmentSide: PlaySegmentSide | null
    availabilityMinutes: number | null
    partialLocked: boolean
  },
  slot: PartialSlot
): boolean => {
  if (signup.availabilityMode === 'FULL_ONLY') {
    return false
  }

  if (signup.partialLocked) {
    return false
  }

  if (signup.availabilityMode === 'PARTIAL_ONLY') {
    const hasValidPreference =
      signup.availabilitySegmentSide !== null &&
      signup.availabilityMinutes !== null &&
      isThirtyMinuteBlock(signup.availabilityMinutes)

    if (!hasValidPreference) {
      return false
    }
  }

  if (signup.availabilitySegmentSide !== null && signup.availabilitySegmentSide !== slot.side) {
    return false
  }

  if (signup.availabilityMinutes !== null && signup.availabilityMinutes !== slot.minutes) {
    return false
  }

  return true
}

const canTakeFullSelection = (signup: {
  availabilityMode: 'FULL_ONLY' | 'FLEX' | 'PARTIAL_ONLY'
  partialLocked: boolean
}): boolean => {
  if (signup.partialLocked) {
    return false
  }

  return signup.availabilityMode !== 'PARTIAL_ONLY'
}

const segmentMatches = (left: TimeSegment, right: TimeSegment): boolean =>
  left.startOffsetMinutes === right.startOffsetMinutes &&
  left.endOffsetMinutes === right.endOffsetMinutes

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

    const sessionDurationMinutes = Math.max(
      Math.round((occurrence.endsAt.getTime() - occurrence.startsAt.getTime()) / millisecondsPerMinute),
      0
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

    const activeSignups = occurrence.subSignups.filter((signup) => signup.status === 'ACTIVE' || signup.status === 'SELECTED')
    const previouslySelectedIds = activeSignups.filter((signup) => signup.status === 'SELECTED').map((signup) => signup.id)

    const normalizedRegistrations: NormalizedRegistration[] = occurrence.registrations.map((registration) => {
      const ownSegment = buildSegment(
        registration.playMode,
        registration.playSegmentSide,
        registration.playMinutes,
        sessionDurationMinutes
      )

      return {
        id: registration.id,
        createdAt: registration.createdAt,
        ownSegment,
        ownMinutes: ownSegment.endOffsetMinutes - ownSegment.startOffsetMinutes,
        gap: buildGapSlot(registration, sessionDurationMinutes),
        fillTargetRegistrationId: registration.fillTargetRegistrationId
      }
    })

    const registrationById = new Map(normalizedRegistrations.map((registration) => [registration.id, registration]))
    const unfilledPartialSlots = normalizedRegistrations
      .map((registration) => registration.gap)
      .filter((slot): slot is PartialSlot => slot !== null)

    const filledTargetRegistrationIds = new Set<string>()
    const fillCommitments = normalizedRegistrations
      .filter((registration) => registration.fillTargetRegistrationId !== null)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())

    for (const filler of fillCommitments) {
      const fillTargetRegistrationId = filler.fillTargetRegistrationId
      if (!fillTargetRegistrationId || filledTargetRegistrationIds.has(fillTargetRegistrationId)) {
        continue
      }

      const target = registrationById.get(fillTargetRegistrationId)
      if (!target?.gap) {
        continue
      }

      const targetGap = target.gap.segment
      const hasOverlap = segmentsOverlap(filler.ownSegment, targetGap)
      const totalMinutes = filler.ownMinutes + target.gap.minutes
      if (hasOverlap || totalMinutes > sessionDurationMinutes) {
        continue
      }

      filledTargetRegistrationIds.add(fillTargetRegistrationId)
    }

    let remainingPartialSlots = unfilledPartialSlots.filter(
      (slot) => !filledTargetRegistrationIds.has(slot.targetRegistrationId)
    )

    let remainingFullSlots = Math.max((occurrence.session.capacity ?? 0) - occurrence.registrations.length, 0)

    const assignmentsBySignupId = new Map<string, SelectionAssignment>()
    const availableSignups = [...activeSignups]

    if (isRegistrationClosed && remainingPartialSlots.length > 0) {
      for (const signup of activeSignups) {
        const isLockedPartialSelection =
          signup.status === 'SELECTED' &&
          signup.partialLocked &&
          signup.selectionType === 'PARTIAL' &&
          signup.assignedStartOffsetMinutes !== null &&
          signup.assignedEndOffsetMinutes !== null

        if (!isLockedPartialSelection) {
          continue
        }

        const lockedSegment: TimeSegment = {
          startOffsetMinutes: signup.assignedStartOffsetMinutes as number,
          endOffsetMinutes: signup.assignedEndOffsetMinutes as number
        }

        const matchingSlotIndex = remainingPartialSlots.findIndex((slot) => segmentMatches(slot.segment, lockedSegment))
        if (matchingSlotIndex === -1) {
          continue
        }

        const matchingSlot = remainingPartialSlots[matchingSlotIndex]
        if (!matchesPartialPreference(signup, matchingSlot)) {
          continue
        }

        assignmentsBySignupId.set(signup.id, {
          selectionType: 'PARTIAL',
          segment: matchingSlot.segment
        })
        remainingPartialSlots.splice(matchingSlotIndex, 1)

        const queueIndex = availableSignups.findIndex((candidate) => candidate.id === signup.id)
        if (queueIndex !== -1) {
          availableSignups.splice(queueIndex, 1)
        }
      }
    }

    if (isRegistrationClosed && remainingFullSlots > 0) {
      for (let index = 0; index < availableSignups.length && remainingFullSlots > 0; ) {
        const signup = availableSignups[index]
        if (!canTakeFullSelection(signup)) {
          index += 1
          continue
        }

        assignmentsBySignupId.set(signup.id, {
          selectionType: 'FULL',
          segment: {
            startOffsetMinutes: 0,
            endOffsetMinutes: sessionDurationMinutes
          }
        })
        remainingFullSlots -= 1
        availableSignups.splice(index, 1)
      }
    }

    if (isRegistrationClosed && remainingPartialSlots.length > 0) {
      for (const slot of remainingPartialSlots) {
        const candidateIndex = availableSignups.findIndex((signup) => matchesPartialPreference(signup, slot))
        if (candidateIndex === -1) {
          continue
        }

        const signup = availableSignups[candidateIndex]
        assignmentsBySignupId.set(signup.id, {
          selectionType: 'PARTIAL',
          segment: slot.segment
        })
        availableSignups.splice(candidateIndex, 1)
      }
    }

    const selectedIds = Array.from(assignmentsBySignupId.keys())
    const selectedIdSet = new Set(selectedIds)
    const previouslySelectedIdSet = new Set(previouslySelectedIds)
    const newlySelectedIds = selectedIds.filter((id) => !previouslySelectedIdSet.has(id))
    const deselectedIds = previouslySelectedIds.filter((id) => !selectedIdSet.has(id))
    const stillActiveIds = activeSignups
      .map((signup) => signup.id)
      .filter((signupId) => !selectedIdSet.has(signupId))

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

    for (const subSignupId of deselectedIds) {
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
      for (const signup of activeSignups) {
        const assignment = assignmentsBySignupId.get(signup.id)
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

        await tx.subSignup.update({
          where: { id: signup.id },
          data: {
            status: 'SELECTED',
            selectedAt: signup.selectedAt ?? selectedAt,
            selectionType: assignment.selectionType,
            assignedStartOffsetMinutes: assignment.segment.startOffsetMinutes,
            assignedEndOffsetMinutes: assignment.segment.endOffsetMinutes
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
        registrationClosed: isRegistrationClosed,
        fullSlotsInitiallyOpen: Math.max((occurrence.session.capacity ?? 0) - occurrence.registrations.length, 0),
        remainingFullSlots,
        remainingPartialSlotCount: remainingPartialSlots.length,
        selectedCount: selectedIds.length,
        newlySelectedCount: newlySelectedIds.length,
        deselectedCount: deselectedIds.length,
        subSelectedNotificationCount: subSelectedNotifications.length,
        subStatusChangedNotificationCount: subStatusChangedNotifications.length
      },
      'Sub selection completed'
    )

    return {
      newlySelectedIds,
      replacedIds: deselectedIds,
      stillActiveIds
    }
  }
}
