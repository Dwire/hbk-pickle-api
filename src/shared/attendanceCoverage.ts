import type { PlaySegmentSide, RegistrationPlayMode } from '../generated/prisma/client.js'

export const partialMinutesBlockSize = 15
const millisecondsPerMinute = 60_000

export type TimeSegment = {
  startOffsetMinutes: number
  endOffsetMinutes: number
}

export type PartialSlot = {
  targetRegistrationId: string
  side: PlaySegmentSide
  minutes: number
  segment: TimeSegment
}

export type RegistrationCoverageInput = {
  id: string
  createdAt: Date
  playMode: RegistrationPlayMode
  playSegmentSide: PlaySegmentSide | null
  playMinutes: number | null
}

type PairingCandidate = {
  id: string
  createdAt: Date
  minutes: number
}

type NormalizedRegistrationCoverage = {
  id: string
  gap: PartialSlot | null
  playSide: PlaySegmentSide | null
  playMinutes: number | null
  createdAt: Date
}

export type EffectiveRegistrationOccupancy = {
  attendingCount: number
  pairedPartialCount: number
  effectiveOccupiedSlots: number
  pairedRegistrationIds: Set<string>
  unpairedPartialSlots: PartialSlot[]
}

export const calculateSessionDurationMinutes = (
  startsAt: Date,
  endsAt: Date
): number =>
  Math.max(
    Math.round((endsAt.getTime() - startsAt.getTime()) / millisecondsPerMinute),
    0
  )

export const isValidPartialMinutes = (
  minutes: number,
  sessionDurationMinutes: number
): boolean =>
  Number.isInteger(minutes) &&
  minutes > 0 &&
  minutes % partialMinutesBlockSize === 0 &&
  minutes < sessionDurationMinutes

export const buildRegistrationOwnSegment = (
  mode: RegistrationPlayMode,
  side: PlaySegmentSide | null,
  minutes: number | null,
  sessionDurationMinutes: number
): TimeSegment => {
  const validPartial =
    mode === 'PARTIAL' &&
    side !== null &&
    minutes !== null &&
    isValidPartialMinutes(minutes, sessionDurationMinutes)

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

export const buildRegistrationGapSlot = (
  registration: {
    id: string
    playMode: RegistrationPlayMode
    playSegmentSide: PlaySegmentSide | null
    playMinutes: number | null
  },
  sessionDurationMinutes: number
): PartialSlot | null => {
  const validPartial =
    registration.playMode === 'PARTIAL' &&
    registration.playSegmentSide !== null &&
    registration.playMinutes !== null &&
    isValidPartialMinutes(registration.playMinutes, sessionDurationMinutes)

  if (!validPartial) {
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

export const segmentsOverlap = (
  left: TimeSegment,
  right: TimeSegment
): boolean =>
  left.startOffsetMinutes < right.endOffsetMinutes &&
  right.startOffsetMinutes < left.endOffsetMinutes

export const segmentsMatch = (left: TimeSegment, right: TimeSegment): boolean =>
  left.startOffsetMinutes === right.startOffsetMinutes &&
  left.endOffsetMinutes === right.endOffsetMinutes

const byCreatedAtThenId = <T extends { createdAt: Date; id: string }>(
  left: T,
  right: T
): number => {
  const createdAtCompare =
    left.createdAt.getTime() - right.createdAt.getTime()
  if (createdAtCompare !== 0) {
    return createdAtCompare
  }

  return left.id.localeCompare(right.id)
}

const buildNormalizedCoverage = (
  registrations: RegistrationCoverageInput[],
  sessionDurationMinutes: number
): NormalizedRegistrationCoverage[] =>
  registrations
    .map((registration) => ({
      id: registration.id,
      gap: buildRegistrationGapSlot(registration, sessionDurationMinutes),
      playSide: registration.playSegmentSide,
      playMinutes: registration.playMinutes,
      createdAt: registration.createdAt
    }))
    .sort(byCreatedAtThenId)

const createPairings = (
  startCandidates: PairingCandidate[],
  endCandidates: PairingCandidate[],
  sessionDurationMinutes: number
): Set<string> => {
  const sortedStarts = [...startCandidates].sort(byCreatedAtThenId)
  const sortedEnds = [...endCandidates].sort(byCreatedAtThenId)
  const rightMatches = new Array<number>(sortedEnds.length).fill(-1)

  const findAugmentingPath = (
    leftIndex: number,
    visitedRightIndexes: Set<number>
  ): boolean => {
    const startCandidate = sortedStarts[leftIndex]
    for (let rightIndex = 0; rightIndex < sortedEnds.length; rightIndex += 1) {
      if (visitedRightIndexes.has(rightIndex)) {
        continue
      }

      const endCandidate = sortedEnds[rightIndex]
      const canPair =
        startCandidate.minutes + endCandidate.minutes <= sessionDurationMinutes
      if (!canPair) {
        continue
      }

      visitedRightIndexes.add(rightIndex)
      if (
        rightMatches[rightIndex] === -1 ||
        findAugmentingPath(rightMatches[rightIndex], visitedRightIndexes)
      ) {
        rightMatches[rightIndex] = leftIndex
        return true
      }
    }

    return false
  }

  for (let leftIndex = 0; leftIndex < sortedStarts.length; leftIndex += 1) {
    findAugmentingPath(leftIndex, new Set<number>())
  }

  const pairedRegistrationIds = new Set<string>()
  for (let rightIndex = 0; rightIndex < rightMatches.length; rightIndex += 1) {
    const leftIndex = rightMatches[rightIndex]
    if (leftIndex === -1) {
      continue
    }

    pairedRegistrationIds.add(sortedStarts[leftIndex].id)
    pairedRegistrationIds.add(sortedEnds[rightIndex].id)
  }

  return pairedRegistrationIds
}

export const calculateEffectiveRegisteredOccupancy = (
  registrations: RegistrationCoverageInput[],
  sessionDurationMinutes: number
): EffectiveRegistrationOccupancy => {
  const attendingCount = registrations.length
  if (attendingCount === 0) {
    return {
      attendingCount,
      pairedPartialCount: 0,
      effectiveOccupiedSlots: 0,
      pairedRegistrationIds: new Set<string>(),
      unpairedPartialSlots: []
    }
  }

  if (sessionDurationMinutes <= 0) {
    return {
      attendingCount,
      pairedPartialCount: 0,
      effectiveOccupiedSlots: attendingCount,
      pairedRegistrationIds: new Set<string>(),
      unpairedPartialSlots: []
    }
  }

  const normalizedRegistrations = buildNormalizedCoverage(
    registrations,
    sessionDurationMinutes
  )

  const startPartials: PairingCandidate[] = []
  const endPartials: PairingCandidate[] = []
  for (const registration of normalizedRegistrations) {
    const validPartial =
      registration.gap !== null &&
      registration.playSide !== null &&
      registration.playMinutes !== null &&
      isValidPartialMinutes(registration.playMinutes, sessionDurationMinutes)
    if (!validPartial) {
      continue
    }

    const candidate: PairingCandidate = {
      id: registration.id,
      createdAt: registration.createdAt,
      minutes: registration.playMinutes as number
    }
    if (registration.playSide === 'START') {
      startPartials.push(candidate)
    } else {
      endPartials.push(candidate)
    }
  }

  const pairedRegistrationIds = createPairings(
    startPartials,
    endPartials,
    sessionDurationMinutes
  )
  const pairedPartialCount = Math.floor(pairedRegistrationIds.size / 2)
  const effectiveOccupiedSlots = Math.max(
    attendingCount - pairedPartialCount,
    0
  )
  const unpairedPartialSlots = normalizedRegistrations
    .filter(
      (registration) =>
        registration.gap !== null &&
        !pairedRegistrationIds.has(registration.id)
    )
    .map((registration) => registration.gap as PartialSlot)

  return {
    attendingCount,
    pairedPartialCount,
    effectiveOccupiedSlots,
    pairedRegistrationIds,
    unpairedPartialSlots
  }
}
