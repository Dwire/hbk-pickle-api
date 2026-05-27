import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  PlaySegmentSide,
  RegistrationPlayMode,
  SubAvailabilityMode
} from '../../generated/prisma/client.js'
import {
  calculateEffectiveRegisteredOccupancy,
  isValidPartialMinutes
} from '../../shared/attendanceCoverage.js'

import {
  computeSubSelection,
  type SelectionRegistrationInput,
  type SelectionSignupInput
} from './subSelectionEngine.js'

const baseTime = new Date('2026-05-24T12:00:00.000Z')
const minimumPairableMinutes = 30

const atSeconds = (seconds: number): Date =>
  new Date(baseTime.getTime() + seconds * 1000)

const registration = (
  id: string,
  options?: {
    createdAtSeconds?: number
    playMode?: RegistrationPlayMode
    side?: PlaySegmentSide | null
    minutes?: number | null
  }
): SelectionRegistrationInput => ({
  id,
  createdAt: atSeconds(options?.createdAtSeconds ?? 0),
  playMode: options?.playMode ?? 'FULL',
  playSegmentSide: options?.side ?? null,
  playMinutes: options?.minutes ?? null
})

const signup = (
  id: string,
  options?: {
    userId?: string
    signedUpAtSeconds?: number
    status?: 'ACTIVE' | 'SELECTED'
    mode?: SubAvailabilityMode
    side?: PlaySegmentSide | null
    minutes?: number | null
    partialLocked?: boolean
    selectionType?: 'FULL' | 'PARTIAL' | null
    assignedStart?: number | null
    assignedEnd?: number | null
  }
): SelectionSignupInput => ({
  id,
  userId: options?.userId ?? `user-${id}`,
  status: options?.status ?? 'ACTIVE',
  availabilityMode: options?.mode ?? 'FLEX',
  availabilitySegmentSide: options?.side ?? null,
  availabilityMinutes: options?.minutes ?? null,
  partialLocked: options?.partialLocked ?? false,
  signedUpAt: atSeconds(options?.signedUpAtSeconds ?? 0),
  selectionType: options?.selectionType ?? null,
  assignedStartOffsetMinutes: options?.assignedStart ?? null,
  assignedEndOffsetMinutes: options?.assignedEnd ?? null
})

test('partial minutes validation uses 15-minute blocks', () => {
  assert.equal(isValidPartialMinutes(15, 120), true)
  assert.equal(isValidPartialMinutes(45, 120), true)
  assert.equal(isValidPartialMinutes(10, 120), false)
  assert.equal(isValidPartialMinutes(120, 120), false)
})

test('effective occupancy auto-pairs only non-overlapping registered partial attendees', () => {
  const registrations = [
    registration('reg-1', { createdAtSeconds: 1, playMode: 'PARTIAL', side: 'START', minutes: 60 }),
    registration('reg-2', { createdAtSeconds: 2, playMode: 'PARTIAL', side: 'END', minutes: 60 }),
    registration('reg-3', { createdAtSeconds: 3, playMode: 'PARTIAL', side: 'START', minutes: 45 }),
    registration('reg-4', { createdAtSeconds: 4, playMode: 'PARTIAL', side: 'END', minutes: 90 }),
    registration('reg-5', { createdAtSeconds: 5, playMode: 'FULL' })
  ]

  const occupancy = calculateEffectiveRegisteredOccupancy(registrations, 120)

  assert.equal(occupancy.attendingCount, 5)
  assert.equal(occupancy.pairedPartialCount, 1)
  assert.equal(occupancy.effectiveOccupiedSlots, 4)
  assert.equal(occupancy.unpairedPartialSlots.length, 2)
})

test('queue order respects FULL_ONLY then FLEX partial when full slots are consumed', () => {
  const result = computeSubSelection({
    sessionDurationMinutes: 120,
    sessionCapacity: 2,
    registrationClosed: true,
    registrations: [
      registration('reg-1', {
        createdAtSeconds: 1,
        playMode: 'PARTIAL',
        side: 'START',
        minutes: 60
      })
    ],
    signups: [
      signup('sub-1', { signedUpAtSeconds: 1, mode: 'FULL_ONLY' }),
      signup('sub-2', { signedUpAtSeconds: 2, mode: 'FLEX' }),
      signup('sub-3', { signedUpAtSeconds: 3, mode: 'PARTIAL_ONLY', side: 'END', minutes: 60 })
    ]
  })

  assert.equal(result.assignmentsBySignupId.get('sub-1')?.selectionType, 'FULL')
  assert.equal(result.assignmentsBySignupId.get('sub-2')?.selectionType, 'PARTIAL')
  assert.equal(result.assignmentsBySignupId.has('sub-3'), false)
})

test('PARTIAL_ONLY can consume a full slot and open complementary partial availability', () => {
  const result = computeSubSelection({
    sessionDurationMinutes: 120,
    sessionCapacity: 1,
    registrationClosed: true,
    registrations: [],
    signups: [
      signup('sub-1', {
        signedUpAtSeconds: 1,
        mode: 'PARTIAL_ONLY',
        side: 'START',
        minutes: 45
      }),
      signup('sub-2', { signedUpAtSeconds: 2, mode: 'FLEX' })
    ]
  })

  const sub1Assignment = result.assignmentsBySignupId.get('sub-1')
  const sub2Assignment = result.assignmentsBySignupId.get('sub-2')
  assert.equal(sub1Assignment?.selectionType, 'PARTIAL')
  assert.deepEqual(sub1Assignment?.segment, {
    startOffsetMinutes: 0,
    endOffsetMinutes: 45
  })
  assert.equal(sub2Assignment?.selectionType, 'PARTIAL')
  assert.deepEqual(sub2Assignment?.segment, {
    startOffsetMinutes: 45,
    endOffsetMinutes: 120
  })
})

test('does not auto-select into residual attendee gaps below 30 minutes', () => {
  const result = computeSubSelection({
    sessionDurationMinutes: 120,
    sessionCapacity: 1,
    registrationClosed: true,
    registrations: [
      registration('reg-1', {
        createdAtSeconds: 1,
        playMode: 'PARTIAL',
        side: 'START',
        minutes: 105
      })
    ],
    signups: [
      signup('sub-1', { signedUpAtSeconds: 1, mode: 'FLEX' }),
      signup('sub-2', { signedUpAtSeconds: 2, mode: 'PARTIAL_ONLY', side: 'END', minutes: 15 })
    ]
  })

  assert.equal(result.assignmentsBySignupId.has('sub-1'), false)
  assert.equal(result.assignmentsBySignupId.has('sub-2'), false)
})

test('PARTIAL_ONLY does not emit complementary partial slots below 30 minutes', () => {
  const result = computeSubSelection({
    sessionDurationMinutes: 120,
    sessionCapacity: 1,
    registrationClosed: true,
    registrations: [],
    signups: [
      signup('sub-short', {
        signedUpAtSeconds: 1,
        mode: 'PARTIAL_ONLY',
        side: 'START',
        minutes: 105
      }),
      signup('sub-next', {
        signedUpAtSeconds: 2,
        mode: 'FLEX',
        side: 'END',
        minutes: minimumPairableMinutes
      })
    ]
  })

  assert.equal(result.assignmentsBySignupId.get('sub-short')?.selectionType, 'PARTIAL')
  assert.equal(result.assignmentsBySignupId.has('sub-next'), false)
})

test('selected FLEX sub is promoted to full when a full slot opens and next sub takes partial slot', () => {
  const result = computeSubSelection({
    sessionDurationMinutes: 120,
    sessionCapacity: 2,
    registrationClosed: true,
    registrations: [
      registration('reg-1', {
        createdAtSeconds: 1,
        playMode: 'PARTIAL',
        side: 'START',
        minutes: 60
      })
    ],
    signups: [
      signup('sub-5', {
        signedUpAtSeconds: 5,
        status: 'SELECTED',
        mode: 'FLEX',
        selectionType: 'PARTIAL',
        assignedStart: 60,
        assignedEnd: 120
      }),
      signup('sub-6', { signedUpAtSeconds: 6, mode: 'FLEX' })
    ]
  })

  assert.equal(result.assignmentsBySignupId.get('sub-5')?.selectionType, 'FULL')
  assert.deepEqual(result.assignmentsBySignupId.get('sub-6')?.segment, {
    startOffsetMinutes: 60,
    endOffsetMinutes: 120
  })
})

test('selected subs stay selected before non-selected queue users when capacity still supports them', () => {
  const result = computeSubSelection({
    sessionDurationMinutes: 120,
    sessionCapacity: 1,
    registrationClosed: true,
    registrations: [],
    signups: [
      signup('sub-active', { signedUpAtSeconds: 1, status: 'ACTIVE', mode: 'FULL_ONLY' }),
      signup('sub-selected', { signedUpAtSeconds: 2, status: 'SELECTED', mode: 'FLEX', selectionType: 'FULL' })
    ]
  })

  assert.equal(result.assignmentsBySignupId.has('sub-selected'), true)
  assert.equal(result.assignmentsBySignupId.has('sub-active'), false)
  assert.equal(result.deselectedIds.length, 0)
})

test('partial lock keeps the exact selected partial slot when available', () => {
  const result = computeSubSelection({
    sessionDurationMinutes: 120,
    sessionCapacity: 2,
    registrationClosed: true,
    registrations: [
      registration('reg-1', {
        createdAtSeconds: 1,
        playMode: 'PARTIAL',
        side: 'START',
        minutes: 60
      })
    ],
    signups: [
      signup('locked-sub', {
        signedUpAtSeconds: 1,
        status: 'SELECTED',
        mode: 'FLEX',
        partialLocked: true,
        selectionType: 'PARTIAL',
        assignedStart: 60,
        assignedEnd: 120
      }),
      signup('full-sub', {
        signedUpAtSeconds: 2,
        status: 'ACTIVE',
        mode: 'FULL_ONLY'
      })
    ]
  })

  assert.deepEqual(result.assignmentsBySignupId.get('locked-sub')?.segment, {
    startOffsetMinutes: 60,
    endOffsetMinutes: 120
  })
  assert.equal(result.assignmentsBySignupId.get('full-sub')?.selectionType, 'FULL')
})
