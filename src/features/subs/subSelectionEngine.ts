import type {
  PlaySegmentSide,
  RegistrationPlayMode,
  SubAvailabilityMode,
  SubSelectionType
} from '../../generated/prisma/client.js'
import {
  buildRegistrationOwnSegment,
  calculateEffectiveRegisteredOccupancy,
  isValidPartialMinutes,
  minimumPairablePlayMinutes,
  type PartialSlot,
  type RegistrationCoverageInput,
  segmentsMatch,
  type TimeSegment
} from '../../shared/attendanceCoverage.js'

export type SelectionAssignment = {
  selectionType: SubSelectionType
  segment: TimeSegment
}

export type SelectionSignupInput = {
  id: string
  userId: string
  status: 'ACTIVE' | 'SELECTED'
  availabilityMode: SubAvailabilityMode
  availabilitySegmentSide: PlaySegmentSide | null
  availabilityMinutes: number | null
  partialLocked: boolean
  signedUpAt: Date
  selectionType: SubSelectionType | null
  assignedStartOffsetMinutes: number | null
  assignedEndOffsetMinutes: number | null
}

export type SelectionRegistrationInput = RegistrationCoverageInput

export type ComputedSubSelection = {
  assignmentsBySignupId: Map<string, SelectionAssignment>
  activeSignups: SelectionSignupInput[]
  previouslySelectedIds: string[]
  newlySelectedIds: string[]
  deselectedIds: string[]
  stillActiveIds: string[]
  initialFullSlots: number
  remainingFullSlots: number
  remainingPartialSlotCount: number
  pairedPartialCount: number
}

type ComputeSubSelectionInput = {
  sessionDurationMinutes: number
  sessionCapacity: number
  registrationClosed: boolean
  registrations: SelectionRegistrationInput[]
  signups: SelectionSignupInput[]
}

type SelectionResources = {
  remainingFullSlots: number
  remainingPartialSlots: PartialSlot[]
}

const fullSegmentStartOffsetMinutes = 0

const bySignedUpAtThenId = (
  left: SelectionSignupInput,
  right: SelectionSignupInput
): number => {
  const signedUpAtCompare =
    left.signedUpAt.getTime() - right.signedUpAt.getTime()
  if (signedUpAtCompare !== 0) {
    return signedUpAtCompare
  }

  return left.id.localeCompare(right.id)
}

const resolveAvailabilitySegment = (
  signup: Pick<
    SelectionSignupInput,
    'availabilitySegmentSide' | 'availabilityMinutes'
  >,
  sessionDurationMinutes: number
): TimeSegment | null => {
  const side = signup.availabilitySegmentSide
  const minutes = signup.availabilityMinutes
  if (
    side === null ||
    minutes === null ||
    minutes < minimumPairablePlayMinutes ||
    !isValidPartialMinutes(minutes, sessionDurationMinutes)
  ) {
    return null
  }

  return buildRegistrationOwnSegment(
    'PARTIAL' as RegistrationPlayMode,
    side,
    minutes,
    sessionDurationMinutes
  )
}

const buildComplementaryPartialSlot = (
  assignedSegment: TimeSegment,
  sessionDurationMinutes: number
): PartialSlot | null => {
  const isFullSelection =
    assignedSegment.startOffsetMinutes === fullSegmentStartOffsetMinutes &&
    assignedSegment.endOffsetMinutes === sessionDurationMinutes
  if (isFullSelection) {
    return null
  }

  if (
    assignedSegment.startOffsetMinutes === fullSegmentStartOffsetMinutes &&
    assignedSegment.endOffsetMinutes < sessionDurationMinutes
  ) {
    const minutes = sessionDurationMinutes - assignedSegment.endOffsetMinutes
    if (minutes < minimumPairablePlayMinutes) {
      return null
    }

    return {
      targetRegistrationId: `generated-${assignedSegment.endOffsetMinutes}`,
      side: 'END',
      minutes,
      segment: {
        startOffsetMinutes: assignedSegment.endOffsetMinutes,
        endOffsetMinutes: sessionDurationMinutes
      }
    }
  }

  if (
    assignedSegment.endOffsetMinutes === sessionDurationMinutes &&
    assignedSegment.startOffsetMinutes > fullSegmentStartOffsetMinutes
  ) {
    const minutes = assignedSegment.startOffsetMinutes
    if (minutes < minimumPairablePlayMinutes) {
      return null
    }

    return {
      targetRegistrationId: `generated-${assignedSegment.startOffsetMinutes}`,
      side: 'START',
      minutes,
      segment: {
        startOffsetMinutes: fullSegmentStartOffsetMinutes,
        endOffsetMinutes: assignedSegment.startOffsetMinutes
      }
    }
  }

  return null
}

const matchesPartialPreference = (
  signup: Pick<
    SelectionSignupInput,
    'availabilityMode' | 'availabilitySegmentSide' | 'availabilityMinutes'
  >,
  slot: PartialSlot,
  sessionDurationMinutes: number
): boolean => {
  if (signup.availabilityMode === 'FULL_ONLY') {
    return false
  }

  if (signup.availabilityMode === 'PARTIAL_ONLY') {
    const validPartialPreference =
      signup.availabilitySegmentSide !== null &&
      signup.availabilityMinutes !== null &&
      isValidPartialMinutes(
        signup.availabilityMinutes,
        sessionDurationMinutes
      )
    if (!validPartialPreference) {
      return false
    }
  }

  if (
    signup.availabilitySegmentSide !== null &&
    signup.availabilitySegmentSide !== slot.side
  ) {
    return false
  }

  if (
    signup.availabilityMinutes !== null &&
    signup.availabilityMinutes !== slot.minutes
  ) {
    return false
  }

  return true
}

const assignFullSlot = (
  signupId: string,
  resources: SelectionResources,
  assignmentsBySignupId: Map<string, SelectionAssignment>,
  sessionDurationMinutes: number
): boolean => {
  if (resources.remainingFullSlots <= 0) {
    return false
  }

  assignmentsBySignupId.set(signupId, {
    selectionType: 'FULL',
    segment: {
      startOffsetMinutes: fullSegmentStartOffsetMinutes,
      endOffsetMinutes: sessionDurationMinutes
    }
  })
  resources.remainingFullSlots -= 1
  return true
}

const assignMatchingPartialSlot = (
  signup: SelectionSignupInput,
  resources: SelectionResources,
  assignmentsBySignupId: Map<string, SelectionAssignment>,
  sessionDurationMinutes: number
): boolean => {
  const candidateIndex = resources.remainingPartialSlots.findIndex(
    (slot) =>
      slot.minutes >= minimumPairablePlayMinutes &&
      matchesPartialPreference(signup, slot, sessionDurationMinutes)
  )
  if (candidateIndex === -1) {
    return false
  }

  const matchingSlot = resources.remainingPartialSlots[candidateIndex]
  assignmentsBySignupId.set(signup.id, {
    selectionType: 'PARTIAL',
    segment: matchingSlot.segment
  })
  resources.remainingPartialSlots.splice(candidateIndex, 1)
  return true
}

const tryAssignSignup = (
  signup: SelectionSignupInput,
  resources: SelectionResources,
  assignmentsBySignupId: Map<string, SelectionAssignment>,
  sessionDurationMinutes: number
): boolean => {
  if (signup.availabilityMode === 'FULL_ONLY') {
    return assignFullSlot(
      signup.id,
      resources,
      assignmentsBySignupId,
      sessionDurationMinutes
    )
  }

  if (signup.availabilityMode === 'FLEX') {
    const assignedFullSlot = assignFullSlot(
      signup.id,
      resources,
      assignmentsBySignupId,
      sessionDurationMinutes
    )
    if (assignedFullSlot) {
      return true
    }

    return assignMatchingPartialSlot(
      signup,
      resources,
      assignmentsBySignupId,
      sessionDurationMinutes
    )
  }

  const assignedPartialSlot = assignMatchingPartialSlot(
    signup,
    resources,
    assignmentsBySignupId,
    sessionDurationMinutes
  )
  if (assignedPartialSlot) {
    return true
  }

  if (resources.remainingFullSlots <= 0) {
    return false
  }

  const preferredSegment = resolveAvailabilitySegment(
    signup,
    sessionDurationMinutes
  )
  if (!preferredSegment) {
    return false
  }

  assignmentsBySignupId.set(signup.id, {
    selectionType: 'PARTIAL',
    segment: preferredSegment
  })
  resources.remainingFullSlots -= 1

  const complementarySlot = buildComplementaryPartialSlot(
    preferredSegment,
    sessionDurationMinutes
  )
  if (complementarySlot) {
    resources.remainingPartialSlots.push(complementarySlot)
  }

  return true
}

export const computeSubSelection = (
  input: ComputeSubSelectionInput
): ComputedSubSelection => {
  const activeSignups = input.signups
    .filter((signup) => signup.status === 'ACTIVE' || signup.status === 'SELECTED')
    .sort(bySignedUpAtThenId)
  const previouslySelectedIds = activeSignups
    .filter((signup) => signup.status === 'SELECTED')
    .map((signup) => signup.id)

  if (input.sessionDurationMinutes <= 0) {
    const stillActiveIds = activeSignups.map((signup) => signup.id)
    return {
      assignmentsBySignupId: new Map<string, SelectionAssignment>(),
      activeSignups,
      previouslySelectedIds,
      newlySelectedIds: [],
      deselectedIds: previouslySelectedIds,
      stillActiveIds,
      initialFullSlots: 0,
      remainingFullSlots: 0,
      remainingPartialSlotCount: 0,
      pairedPartialCount: 0
    }
  }

  const registrationOccupancy = calculateEffectiveRegisteredOccupancy(
    input.registrations,
    input.sessionDurationMinutes
  )
  const initialFullSlots = Math.max(
    input.sessionCapacity - registrationOccupancy.effectiveOccupiedSlots,
    0
  )
  const resources: SelectionResources = {
    remainingFullSlots: initialFullSlots,
    remainingPartialSlots: registrationOccupancy.unpairedPartialSlots.filter(
      (slot) => slot.minutes >= minimumPairablePlayMinutes
    )
  }
  const assignmentsBySignupId = new Map<string, SelectionAssignment>()

  if (input.registrationClosed) {
    const selectedSignups = activeSignups.filter(
      (signup) => signup.status === 'SELECTED'
    )

    for (const signup of selectedSignups) {
      const isLockedPartialSelection =
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
      const matchingSlotIndex = resources.remainingPartialSlots.findIndex(
        (slot) => segmentsMatch(slot.segment, lockedSegment)
      )
      if (matchingSlotIndex === -1) {
        continue
      }

      const matchingSlot = resources.remainingPartialSlots[matchingSlotIndex]
      const lockedPreferenceMatchesSlot = matchesPartialPreference(
        signup,
        matchingSlot,
        input.sessionDurationMinutes
      )
      if (!lockedPreferenceMatchesSlot) {
        continue
      }

      assignmentsBySignupId.set(signup.id, {
        selectionType: 'PARTIAL',
        segment: matchingSlot.segment
      })
      resources.remainingPartialSlots.splice(matchingSlotIndex, 1)
    }

    for (const signup of selectedSignups) {
      const hasAssignment = assignmentsBySignupId.has(signup.id)
      if (hasAssignment || signup.partialLocked) {
        continue
      }

      tryAssignSignup(
        signup,
        resources,
        assignmentsBySignupId,
        input.sessionDurationMinutes
      )
    }

    const nonSelectedSignups = activeSignups.filter(
      (signup) => signup.status === 'ACTIVE'
    )
    for (const signup of nonSelectedSignups) {
      tryAssignSignup(
        signup,
        resources,
        assignmentsBySignupId,
        input.sessionDurationMinutes
      )
    }
  }

  const selectedIds = Array.from(assignmentsBySignupId.keys())
  const selectedIdSet = new Set(selectedIds)
  const previouslySelectedIdSet = new Set(previouslySelectedIds)
  const newlySelectedIds = selectedIds.filter(
    (id) => !previouslySelectedIdSet.has(id)
  )
  const deselectedIds = previouslySelectedIds.filter(
    (id) => !selectedIdSet.has(id)
  )
  const stillActiveIds = activeSignups
    .map((signup) => signup.id)
    .filter((signupId) => !selectedIdSet.has(signupId))

  return {
    assignmentsBySignupId,
    activeSignups,
    previouslySelectedIds,
    newlySelectedIds,
    deselectedIds,
    stillActiveIds,
    initialFullSlots,
    remainingFullSlots: resources.remainingFullSlots,
    remainingPartialSlotCount: resources.remainingPartialSlots.length,
    pairedPartialCount: registrationOccupancy.pairedPartialCount
  }
}
