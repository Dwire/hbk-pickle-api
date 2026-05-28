import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { GraphQLError } from 'graphql'

import { notificationQueue, subSelectionQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'
import { SessionService } from '../sessions/sessionService.js'

import { RegistrationService } from './registrationService.js'

const occurrenceId = 'occ-1'
const userId = 'user-1'

after(async () => {
  await notificationQueue.close()
  await subSelectionQueue.close()
  await prisma.$disconnect()
})

class NonRebalancingRegistrationService extends RegistrationService {
  protected override shouldTriggerRebalance(): boolean {
    return false
  }

  protected override async rebalanceOccurrence(): Promise<void> {
    // no-op for tests
  }
}

type SetupRegistrationPlayPreferenceOptions = {
  closeAt: Date
  currentPlayMode: 'FULL' | 'PARTIAL'
  currentPlaySegmentSide: 'START' | 'END' | null
  currentPlayMinutes: number | null
  nextInput: {
    mode: 'FULL' | 'PARTIAL'
    side?: 'START' | 'END' | null
    minutes?: number | null
  }
}

const setupSetPlayPreferenceTest = (
  t: test.TestContext,
  options: SetupRegistrationPlayPreferenceOptions
) => {
  const service = new NonRebalancingRegistrationService()

  const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const endsAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
  const occurrence = {
    id: occurrenceId,
    status: 'ACTIVE',
    startsAt,
    endsAt,
    session: { id: 'session-1', leagueId: 'league-1' }
  }
  const registration = {
    id: 'reg-1',
    userId,
    occurrenceId,
    status: 'ATTENDING',
    playMode: options.currentPlayMode,
    playSegmentSide: options.currentPlaySegmentSide,
    playMinutes: options.currentPlayMinutes,
    fillTargetRegistrationId: null
  }

  const sessionServicePrototype = SessionService.prototype as unknown as {
    calculateRegistrationWindow: (startsAt: Date) => {
      registrationOpenAt: Date
      registrationCloseAt: Date
      subSignupCloseAt: Date
    }
  }
  const transactionPrisma = prisma as unknown as {
    $transaction: (queries: Promise<unknown>[]) => Promise<unknown[]>
  }
  const sessionOccurrenceDelegate = prisma.sessionOccurrence as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const registrationDelegate = prisma.sessionRegistration as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
    update: (...args: unknown[]) => Promise<unknown>
  }

  const originalCalculateRegistrationWindow = sessionServicePrototype.calculateRegistrationWindow
  const originalTransaction = transactionPrisma.$transaction
  const originalOccurrenceFindUnique = sessionOccurrenceDelegate.findUnique
  const originalRegistrationFindUnique = registrationDelegate.findUnique
  const originalRegistrationUpdate = registrationDelegate.update

  sessionServicePrototype.calculateRegistrationWindow = () => ({
    registrationOpenAt: new Date(options.closeAt.getTime() - 60 * 60 * 1000),
    registrationCloseAt: options.closeAt,
    subSignupCloseAt: endsAt
  })
  transactionPrisma.$transaction = async (queries: Promise<unknown>[]) =>
    Promise.all(queries)
  sessionOccurrenceDelegate.findUnique = async () => occurrence
  registrationDelegate.findUnique = async () => registration
  registrationDelegate.update = async (...args: unknown[]) => ({
    ...registration,
    ...(args[0] as {
      data: {
        playMode: 'FULL' | 'PARTIAL'
        playSegmentSide: 'START' | 'END' | null
        playMinutes: number | null
        fillTargetRegistrationId: string | null
      }
    }).data
  })

  t.after(() => {
    sessionServicePrototype.calculateRegistrationWindow = originalCalculateRegistrationWindow
    transactionPrisma.$transaction = originalTransaction
    sessionOccurrenceDelegate.findUnique = originalOccurrenceFindUnique
    registrationDelegate.findUnique = originalRegistrationFindUnique
    registrationDelegate.update = originalRegistrationUpdate
  })

  const action = () =>
    service.setPlayPreference(userId, occurrenceId, {
      mode: options.nextInput.mode,
      side: options.nextInput.side ?? null,
      minutes: options.nextInput.minutes ?? null,
      fillTargetRegistrationId: null
    })

  return { action }
}

test('setPlayPreference post-close equal duration succeeds', async (t) => {
  const closeAt = new Date(Date.now() - 1000)
  const { action } = setupSetPlayPreferenceTest(t, {
    closeAt,
    currentPlayMode: 'FULL',
    currentPlaySegmentSide: null,
    currentPlayMinutes: null,
    nextInput: {
      mode: 'FULL'
    }
  })

  const result = await action()

  assert.equal(result.playMode, 'FULL')
  assert.equal(result.playMinutes, null)
})

test('setPlayPreference post-close shorter duration succeeds', async (t) => {
  const closeAt = new Date(Date.now() - 1000)
  const { action } = setupSetPlayPreferenceTest(t, {
    closeAt,
    currentPlayMode: 'FULL',
    currentPlaySegmentSide: null,
    currentPlayMinutes: null,
    nextInput: {
      mode: 'PARTIAL',
      side: 'START',
      minutes: 60
    }
  })

  const result = await action()

  assert.equal(result.playMode, 'PARTIAL')
  assert.equal(result.playSegmentSide, 'START')
  assert.equal(result.playMinutes, 60)
})

test('setPlayPreference post-close longer duration fails with BAD_USER_INPUT reason', async (t) => {
  const closeAt = new Date(Date.now() - 1000)
  const { action } = setupSetPlayPreferenceTest(t, {
    closeAt,
    currentPlayMode: 'PARTIAL',
    currentPlaySegmentSide: 'START',
    currentPlayMinutes: 60,
    nextInput: {
      mode: 'FULL'
    }
  })

  await assert.rejects(
    action,
    (error: unknown) => {
      assert.ok(error instanceof GraphQLError)
      assert.equal(error.extensions.code, 'BAD_USER_INPUT')
      assert.equal(
        error.extensions.reason,
        'REGISTRATION_WINDOW_CLOSED_EXTENSION_NOT_ALLOWED'
      )
      return true
    }
  )
})

test('setPlayPreference at registration close boundary rejects longer duration', async (t) => {
  const originalDate = Date
  const fixedNow = new Date('2026-05-28T12:00:00.000Z')

  class MockDate extends Date {
    constructor(value?: string | number | Date) {
      if (value !== undefined) {
        super(value)
        return
      }

      super(fixedNow)
    }

    static override now(): number {
      return fixedNow.getTime()
    }
  }

  globalThis.Date = MockDate as unknown as DateConstructor
  t.after(() => {
    globalThis.Date = originalDate
  })

  const closeAt = new Date(fixedNow)
  const { action } = setupSetPlayPreferenceTest(t, {
    closeAt,
    currentPlayMode: 'PARTIAL',
    currentPlaySegmentSide: 'START',
    currentPlayMinutes: 60,
    nextInput: {
      mode: 'FULL'
    }
  })

  await assert.rejects(
    action,
    (error: unknown) => {
      assert.ok(error instanceof GraphQLError)
      assert.equal(error.extensions.code, 'BAD_USER_INPUT')
      assert.equal(
        error.extensions.reason,
        'REGISTRATION_WINDOW_CLOSED_EXTENSION_NOT_ALLOWED'
      )
      return true
    }
  )
})

test('setPlayPreference pre-close longer duration succeeds', async (t) => {
  const closeAt = new Date(Date.now() + 60 * 1000)
  const { action } = setupSetPlayPreferenceTest(t, {
    closeAt,
    currentPlayMode: 'PARTIAL',
    currentPlaySegmentSide: 'START',
    currentPlayMinutes: 60,
    nextInput: {
      mode: 'FULL'
    }
  })

  const result = await action()

  assert.equal(result.playMode, 'FULL')
  assert.equal(result.playSegmentSide, null)
  assert.equal(result.playMinutes, null)
})
