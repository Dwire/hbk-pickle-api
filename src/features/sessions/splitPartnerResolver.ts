import type { PlaySegmentSide } from '../../generated/prisma/client.js'
import {
  matchEdgeAlignedPartials,
  segmentsOverlap
} from '../../shared/attendanceCoverage.js'

export type SplitPartnerSummary = {
  id: string
  displayName: string | null
  profileImageUrl: string | null
}

export type SplitPartnerAttendeeCandidate = {
  rosterEntryId: string
  participant: SplitPartnerSummary
  startOffsetMinutes: number
  endOffsetMinutes: number
  playSegmentSide: PlaySegmentSide
  playMinutes: number
  createdAt: Date
}

export type SplitPartnerSubCandidate = {
  rosterEntryId: string
  participant: SplitPartnerSummary
  startOffsetMinutes: number
  endOffsetMinutes: number
  signedUpAt: Date
}

type NormalizedSplitPartnerCandidate = {
  rosterEntryId: string
  participant: SplitPartnerSummary
  startOffsetMinutes: number
  endOffsetMinutes: number
  sortTime: Date
}

const bySortTimeThenId = (
  left: NormalizedSplitPartnerCandidate,
  right: NormalizedSplitPartnerCandidate
): number => {
  const sortTimeCompare = left.sortTime.getTime() - right.sortTime.getTime()
  if (sortTimeCompare !== 0) {
    return sortTimeCompare
  }

  return left.rosterEntryId.localeCompare(right.rosterEntryId)
}

const isValidSegment = (
  candidate: NormalizedSplitPartnerCandidate,
  sessionDurationMinutes: number
): boolean =>
  Number.isInteger(candidate.startOffsetMinutes) &&
  Number.isInteger(candidate.endOffsetMinutes) &&
  candidate.startOffsetMinutes >= 0 &&
  candidate.endOffsetMinutes > candidate.startOffsetMinutes &&
  candidate.endOffsetMinutes <= sessionDurationMinutes

const areCompatibleSplitPartners = (
  left: NormalizedSplitPartnerCandidate,
  right: NormalizedSplitPartnerCandidate,
  sessionDurationMinutes: number
): boolean => {
  if (
    !isValidSegment(left, sessionDurationMinutes) ||
    !isValidSegment(right, sessionDurationMinutes)
  ) {
    return false
  }

  const leftSegment = {
    startOffsetMinutes: left.startOffsetMinutes,
    endOffsetMinutes: left.endOffsetMinutes
  }
  const rightSegment = {
    startOffsetMinutes: right.startOffsetMinutes,
    endOffsetMinutes: right.endOffsetMinutes
  }
  if (segmentsOverlap(leftSegment, rightSegment)) {
    return false
  }

  const coveredStart = Math.min(
    left.startOffsetMinutes,
    right.startOffsetMinutes
  )
  const coveredEnd = Math.max(left.endOffsetMinutes, right.endOffsetMinutes)

  return (
    coveredStart >= 0 &&
    coveredEnd <= sessionDurationMinutes
  )
}

const pairCandidates = (
  left: NormalizedSplitPartnerCandidate,
  right: NormalizedSplitPartnerCandidate,
  pairedByRosterEntryId: Map<string, SplitPartnerSummary>,
  pairedRosterEntryIds: Set<string>
): void => {
  pairedByRosterEntryId.set(left.rosterEntryId, right.participant)
  pairedByRosterEntryId.set(right.rosterEntryId, left.participant)
  pairedRosterEntryIds.add(left.rosterEntryId)
  pairedRosterEntryIds.add(right.rosterEntryId)
}

const normalizeAttendeeCandidates = (
  candidates: SplitPartnerAttendeeCandidate[]
): NormalizedSplitPartnerCandidate[] =>
  candidates
    .map((candidate) => ({
      rosterEntryId: candidate.rosterEntryId,
      participant: candidate.participant,
      startOffsetMinutes: candidate.startOffsetMinutes,
      endOffsetMinutes: candidate.endOffsetMinutes,
      sortTime: candidate.createdAt
    }))
    .sort(bySortTimeThenId)

const normalizeSubCandidates = (
  candidates: SplitPartnerSubCandidate[]
): NormalizedSplitPartnerCandidate[] =>
  candidates
    .map((candidate) => ({
      rosterEntryId: candidate.rosterEntryId,
      participant: candidate.participant,
      startOffsetMinutes: candidate.startOffsetMinutes,
      endOffsetMinutes: candidate.endOffsetMinutes,
      sortTime: candidate.signedUpAt
    }))
    .sort(bySortTimeThenId)

const pairWithinPool = (
  pool: NormalizedSplitPartnerCandidate[],
  sessionDurationMinutes: number,
  pairedByRosterEntryId: Map<string, SplitPartnerSummary>,
  pairedRosterEntryIds: Set<string>
): void => {
  for (let leftIndex = 0; leftIndex < pool.length; leftIndex += 1) {
    const left = pool[leftIndex]
    if (pairedRosterEntryIds.has(left.rosterEntryId)) {
      continue
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < pool.length;
      rightIndex += 1
    ) {
      const right = pool[rightIndex]
      if (pairedRosterEntryIds.has(right.rosterEntryId)) {
        continue
      }

      if (
        !areCompatibleSplitPartners(left, right, sessionDurationMinutes)
      ) {
        continue
      }

      pairCandidates(
        left,
        right,
        pairedByRosterEntryId,
        pairedRosterEntryIds
      )
      break
    }
  }
}

const pairAcrossPools = (
  leftPool: NormalizedSplitPartnerCandidate[],
  rightPool: NormalizedSplitPartnerCandidate[],
  sessionDurationMinutes: number,
  pairedByRosterEntryId: Map<string, SplitPartnerSummary>,
  pairedRosterEntryIds: Set<string>
): void => {
  for (const left of leftPool) {
    if (pairedRosterEntryIds.has(left.rosterEntryId)) {
      continue
    }

    for (const right of rightPool) {
      if (pairedRosterEntryIds.has(right.rosterEntryId)) {
        continue
      }

      if (
        !areCompatibleSplitPartners(left, right, sessionDurationMinutes)
      ) {
        continue
      }

      pairCandidates(
        left,
        right,
        pairedByRosterEntryId,
        pairedRosterEntryIds
      )
      break
    }
  }
}

export type ResolveSplitPartnerMapInput = {
  sessionDurationMinutes: number
  attendeeCandidates: SplitPartnerAttendeeCandidate[]
  subCandidates: SplitPartnerSubCandidate[]
}

/**
 * Resolves row-level split-partner metadata for occurrence-detail roster entries.
 * Pairing is deterministic and phase-ordered:
 * 1) attendee-attendee
 * 2) attendee-sub
 * 3) sub-sub
 */
export const resolveSplitPartnerMap = ({
  sessionDurationMinutes,
  attendeeCandidates,
  subCandidates
}: ResolveSplitPartnerMapInput): Map<string, SplitPartnerSummary> => {
  const pairedByRosterEntryId = new Map<string, SplitPartnerSummary>()
  if (sessionDurationMinutes <= 0) {
    return pairedByRosterEntryId
  }

  const normalizedAttendees = normalizeAttendeeCandidates(attendeeCandidates)
  const normalizedSubs = normalizeSubCandidates(subCandidates)
  const pairedRosterEntryIds = new Set<string>()

  const matchedAttendeePairs = matchEdgeAlignedPartials(
    attendeeCandidates.map((candidate) => ({
      id: candidate.rosterEntryId,
      createdAt: candidate.createdAt,
      side: candidate.playSegmentSide,
      minutes: candidate.playMinutes
    })),
    sessionDurationMinutes
  )
  const attendeeCandidateByRosterEntryId = new Map(
    normalizedAttendees.map((candidate) => [candidate.rosterEntryId, candidate])
  )
  for (const matchedAttendeePair of matchedAttendeePairs) {
    const startCandidate = attendeeCandidateByRosterEntryId.get(
      matchedAttendeePair.startCandidateId
    )
    const endCandidate = attendeeCandidateByRosterEntryId.get(
      matchedAttendeePair.endCandidateId
    )
    if (!startCandidate || !endCandidate) {
      continue
    }

    pairCandidates(
      startCandidate,
      endCandidate,
      pairedByRosterEntryId,
      pairedRosterEntryIds
    )
  }

  // Priority order:
  // 1) attendee-attendee (shared occupancy matcher)
  // 2) attendee-sub
  // 3) sub-sub
  pairAcrossPools(
    normalizedAttendees,
    normalizedSubs,
    sessionDurationMinutes,
    pairedByRosterEntryId,
    pairedRosterEntryIds
  )
  pairWithinPool(
    normalizedSubs,
    sessionDurationMinutes,
    pairedByRosterEntryId,
    pairedRosterEntryIds
  )

  return pairedByRosterEntryId
}
