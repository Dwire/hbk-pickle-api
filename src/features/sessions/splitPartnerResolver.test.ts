import assert from 'node:assert/strict'
import test from 'node:test'

import {
  matchEdgeAlignedPartials,
  type MatchedPartialPair
} from '../../shared/attendanceCoverage.js'

import {
  resolveSplitPartnerMap,
  type SplitPartnerAttendeeCandidate,
  type SplitPartnerSubCandidate
} from './splitPartnerResolver.js'

const baseTime = new Date('2026-05-24T12:00:00.000Z')

const atSeconds = (seconds: number): Date =>
  new Date(baseTime.getTime() + seconds * 1_000)

const attendee = (
  rosterEntryId: string,
  startOffsetMinutes: number,
  endOffsetMinutes: number,
  createdAtSeconds: number
): SplitPartnerAttendeeCandidate => ({
  rosterEntryId,
  participant: {
    id: `user-${rosterEntryId}`,
    displayName: `Attendee ${rosterEntryId}`,
    profileImageUrl: `https://example.com/${rosterEntryId}.png`
  },
  startOffsetMinutes,
  endOffsetMinutes,
  playSegmentSide: startOffsetMinutes === 0 ? 'START' : 'END',
  playMinutes: endOffsetMinutes - startOffsetMinutes,
  createdAt: atSeconds(createdAtSeconds)
})

const sub = (
  rosterEntryId: string,
  startOffsetMinutes: number,
  endOffsetMinutes: number,
  signedUpAtSeconds: number
): SplitPartnerSubCandidate => ({
  rosterEntryId,
  participant: {
    id: `user-${rosterEntryId}`,
    displayName: `Sub ${rosterEntryId}`,
    profileImageUrl: `https://example.com/${rosterEntryId}.png`
  },
  startOffsetMinutes,
  endOffsetMinutes,
  signedUpAt: atSeconds(signedUpAtSeconds)
})

test('pairs two registered partial attendees and sets each other as split partner', () => {
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates: [attendee('att-1', 0, 60, 1), attendee('att-2', 60, 120, 2)],
    subCandidates: []
  })

  assert.equal(splitPartnerMap.get('att-1')?.id, 'user-att-2')
  assert.equal(splitPartnerMap.get('att-2')?.id, 'user-att-1')
})

test('pairs attendee with selected partial sub when no attendee partner exists', () => {
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates: [attendee('att-1', 0, 45, 1)],
    subCandidates: [sub('sub-1', 45, 120, 1)]
  })

  assert.equal(splitPartnerMap.get('att-1')?.id, 'user-sub-1')
  assert.equal(splitPartnerMap.get('sub-1')?.id, 'user-att-1')
})

test('pairs selected partial subs in fallback phase', () => {
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates: [],
    subCandidates: [sub('sub-1', 0, 60, 1), sub('sub-2', 60, 120, 2)]
  })

  assert.equal(splitPartnerMap.get('sub-1')?.id, 'user-sub-2')
  assert.equal(splitPartnerMap.get('sub-2')?.id, 'user-sub-1')
})

test('uses registered-pair priority then deterministic ordering', () => {
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates: [
      attendee('att-1', 0, 60, 1),
      attendee('att-2', 60, 120, 2),
      attendee('att-3', 0, 60, 3)
    ],
    subCandidates: [
      sub('sub-2', 60, 120, 2),
      sub('sub-1', 60, 120, 1)
    ]
  })

  // Registered pair should happen first.
  assert.equal(splitPartnerMap.get('att-1')?.id, 'user-att-2')
  assert.equal(splitPartnerMap.get('att-2')?.id, 'user-att-1')
  // Remaining attendee should pick earliest compatible sub by signedUpAt.
  assert.equal(splitPartnerMap.get('att-3')?.id, 'user-sub-1')
  assert.equal(splitPartnerMap.get('sub-1')?.id, 'user-att-3')
})

test('pairs non-overlapping rows even when combined coverage has dead time', () => {
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates: [attendee('att-1', 0, 30, 1)],
    subCandidates: [sub('sub-1', 60, 120, 1)]
  })

  assert.equal(splitPartnerMap.get('att-1')?.id, 'user-sub-1')
  assert.equal(splitPartnerMap.get('sub-1')?.id, 'user-att-1')
})

test('does not pair rows when either side has less than 30 minutes', () => {
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates: [attendee('att-1', 0, 15, 1)],
    subCandidates: [sub('sub-1', 60, 120, 1)]
  })

  assert.equal(splitPartnerMap.has('att-1'), false)
  assert.equal(splitPartnerMap.has('sub-1'), false)
})

test('returns no split partners when there are no partial candidates (full rows)', () => {
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates: [],
    subCandidates: []
  })

  assert.equal(splitPartnerMap.size, 0)
})

test('returns stable pairings across repeated runs', () => {
  const input = {
    sessionDurationMinutes: 120,
    attendeeCandidates: [
      attendee('att-1', 0, 60, 1),
      attendee('att-2', 60, 120, 2),
      attendee('att-3', 0, 45, 3)
    ],
    subCandidates: [sub('sub-1', 45, 120, 1)]
  }

  const firstResult = resolveSplitPartnerMap(input)
  const secondResult = resolveSplitPartnerMap(input)

  assert.deepEqual(Array.from(firstResult.entries()), Array.from(secondResult.entries()))
})

test('attendee-attendee split partners match shared occupancy matcher edges', () => {
  const attendeeCandidates: SplitPartnerAttendeeCandidate[] = [
    attendee('att-a', 0, 75, 1),
    attendee('att-b', 75, 120, 2),
    attendee('att-c', 0, 45, 3),
    attendee('att-d', 45, 120, 4)
  ]
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates,
    subCandidates: []
  })

  const matchedPairs = matchEdgeAlignedPartials(
    attendeeCandidates.map((candidate) => ({
      id: candidate.rosterEntryId,
      createdAt: candidate.createdAt,
      side: candidate.playSegmentSide,
      minutes: candidate.playMinutes
    })),
    120
  )
  const matchedPairSet = new Set(
    matchedPairs.map((pair: MatchedPartialPair) =>
      [pair.startCandidateId, pair.endCandidateId].sort().join('|')
    )
  )

  const observedAttendeePairSet = new Set(
    attendeeCandidates
      .map((candidate) => {
        const partnerId = splitPartnerMap.get(candidate.rosterEntryId)?.id
        if (!partnerId) {
          return null
        }

        const partnerRosterEntryId = attendeeCandidates.find(
          (entry) => entry.participant.id === partnerId
        )?.rosterEntryId
        if (!partnerRosterEntryId) {
          return null
        }

        return [candidate.rosterEntryId, partnerRosterEntryId].sort().join('|')
      })
      .filter((value): value is string => value !== null)
  )

  assert.deepEqual(observedAttendeePairSet, matchedPairSet)
})
