import assert from 'node:assert/strict'
import test from 'node:test'

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

test('leaves unpaired partial rows without split partner', () => {
  const splitPartnerMap = resolveSplitPartnerMap({
    sessionDurationMinutes: 120,
    attendeeCandidates: [attendee('att-1', 0, 30, 1)],
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
