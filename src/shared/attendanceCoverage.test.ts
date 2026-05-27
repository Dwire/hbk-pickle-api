import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRegistrationGapSlot,
  calculateEffectiveRegisteredOccupancy,
  matchEdgeAlignedPartials,
  minimumPairablePlayMinutes,
  type RegistrationCoverageInput
} from './attendanceCoverage.js'

const baseTime = new Date('2026-05-24T12:00:00.000Z')

const atSeconds = (seconds: number): Date =>
  new Date(baseTime.getTime() + seconds * 1_000)

test('matchEdgeAlignedPartials uses max-cardinality matching deterministically', () => {
  const matchedPairs = matchEdgeAlignedPartials(
    [
      { id: 'start-1', createdAt: atSeconds(1), side: 'START', minutes: 75 },
      { id: 'start-2', createdAt: atSeconds(2), side: 'START', minutes: 45 },
      { id: 'end-1', createdAt: atSeconds(1), side: 'END', minutes: 45 },
      { id: 'end-2', createdAt: atSeconds(2), side: 'END', minutes: 75 }
    ],
    120
  )

  assert.deepEqual(matchedPairs, [
    { startCandidateId: 'start-1', endCandidateId: 'end-1' },
    { startCandidateId: 'start-2', endCandidateId: 'end-2' }
  ])
})

test('matchEdgeAlignedPartials ignores candidates with less than minimum pairable minutes', () => {
  const matchedPairs = matchEdgeAlignedPartials(
    [
      { id: 'start-short', createdAt: atSeconds(1), side: 'START', minutes: 15 },
      { id: 'start-valid', createdAt: atSeconds(2), side: 'START', minutes: minimumPairablePlayMinutes },
      { id: 'end-valid', createdAt: atSeconds(1), side: 'END', minutes: minimumPairablePlayMinutes },
      { id: 'end-short', createdAt: atSeconds(2), side: 'END', minutes: 15 }
    ],
    120
  )

  assert.deepEqual(matchedPairs, [
    { startCandidateId: 'start-valid', endCandidateId: 'end-valid' }
  ])
})

test('calculateEffectiveRegisteredOccupancy returns explicit matched pair edges', () => {
  const registrations: RegistrationCoverageInput[] = [
    {
      id: 'reg-1',
      createdAt: atSeconds(1),
      playMode: 'PARTIAL',
      playSegmentSide: 'START',
      playMinutes: 75
    },
    {
      id: 'reg-2',
      createdAt: atSeconds(2),
      playMode: 'PARTIAL',
      playSegmentSide: 'END',
      playMinutes: 45
    },
    {
      id: 'reg-3',
      createdAt: atSeconds(3),
      playMode: 'PARTIAL',
      playSegmentSide: 'START',
      playMinutes: 45
    },
    {
      id: 'reg-4',
      createdAt: atSeconds(4),
      playMode: 'PARTIAL',
      playSegmentSide: 'END',
      playMinutes: 75
    }
  ]

  const occupancy = calculateEffectiveRegisteredOccupancy(registrations, 120)

  assert.equal(occupancy.pairedPartialCount, 2)
  assert.equal(occupancy.effectiveOccupiedSlots, 2)
  assert.deepEqual(occupancy.matchedPairs, [
    { startCandidateId: 'reg-1', endCandidateId: 'reg-2' },
    { startCandidateId: 'reg-3', endCandidateId: 'reg-4' }
  ])
})

test('buildRegistrationGapSlot does not expose residual gaps below 30 minutes', () => {
  const shortGap = buildRegistrationGapSlot(
    {
      id: 'reg-short-gap',
      playMode: 'PARTIAL',
      playSegmentSide: 'START',
      playMinutes: 105
    },
    120
  )
  const boundaryGap = buildRegistrationGapSlot(
    {
      id: 'reg-boundary-gap',
      playMode: 'PARTIAL',
      playSegmentSide: 'START',
      playMinutes: 90
    },
    120
  )

  assert.equal(shortGap, null)
  assert.equal(boundaryGap?.minutes, minimumPairablePlayMinutes)
})
