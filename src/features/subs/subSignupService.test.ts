import assert from 'node:assert/strict'
import test from 'node:test'

import { notificationQueue, subSelectionQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'
import { SessionService } from '../sessions/sessionService.js'

import { SubSignupService } from './subSignupService.js'

type SignupOptions = {
  triggerRebalance?: boolean
}

const activeOccurrenceStatus = 'ACTIVE'
const startsAtIso = '2026-05-26T18:00:00.000Z'
const endsAtIso = '2026-05-26T20:00:00.000Z'
const userId = 'user-1'
const occurrenceId = 'occ-1'
const ensuredSignupId = 'sub-1'

class TestableSubSignupService extends SubSignupService {
  public rebalanceCallCount = 0
  public signupCallOptions: SignupOptions[] = []

  protected override shouldTriggerRebalance(): boolean {
    return true
  }

  protected override async rebalanceOccurrence(): Promise<void> {
    this.rebalanceCallCount += 1
  }

  public override async signup(
    ensuredUserId: string,
    ensuredOccurrenceId: string,
    options?: SignupOptions
  ) {
    this.signupCallOptions.push(options ?? {})

    return {
      id: ensuredSignupId,
      userId: ensuredUserId,
      occurrenceId: ensuredOccurrenceId,
      status: 'ACTIVE',
      partialLocked: false,
      partialLockedAt: null
    } as unknown as Awaited<ReturnType<SubSignupService['signup']>>
  }
}

test('setAvailabilityPreference triggers one rebalance when ensuring signup first', async (t) => {
  const service = new TestableSubSignupService()
  const startsAt = new Date(startsAtIso)
  const endsAt = new Date(endsAtIso)
  const occurrence = {
    id: occurrenceId,
    status: activeOccurrenceStatus,
    startsAt,
    endsAt,
    session: {}
  }
  const updatedSignup = {
    id: ensuredSignupId,
    userId,
    occurrenceId,
    availabilityMode: 'FLEX',
    availabilitySegmentSide: null,
    availabilityMinutes: null,
    partialLocked: false,
    partialLockedAt: null
  }

  const sessionServicePrototype = SessionService.prototype as unknown as {
    isWithinSubSignupWindow: (now: Date, endsAt: Date) => boolean
  }
  const sessionOccurrenceDelegate = prisma.sessionOccurrence as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const subSignupDelegate = prisma.subSignup as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
    update: (...args: unknown[]) => Promise<unknown>
  }

  const originalIsWithinSubSignupWindow = sessionServicePrototype.isWithinSubSignupWindow
  const originalOccurrenceFindUnique = sessionOccurrenceDelegate.findUnique
  const originalSubSignupFindUnique = subSignupDelegate.findUnique
  const originalSubSignupUpdate = subSignupDelegate.update

  sessionServicePrototype.isWithinSubSignupWindow = () => true
  sessionOccurrenceDelegate.findUnique = async () => occurrence
  subSignupDelegate.findUnique = async () => null
  subSignupDelegate.update = async () => updatedSignup

  t.after(async () => {
    sessionServicePrototype.isWithinSubSignupWindow = originalIsWithinSubSignupWindow
    sessionOccurrenceDelegate.findUnique = originalOccurrenceFindUnique
    subSignupDelegate.findUnique = originalSubSignupFindUnique
    subSignupDelegate.update = originalSubSignupUpdate
    await notificationQueue.close()
    await subSelectionQueue.close()
    await prisma.$disconnect()
  })

  const result = await service.setAvailabilityPreference(userId, occurrenceId, {
    availabilityMode: 'FLEX'
  })

  assert.equal(result.id, updatedSignup.id)
  assert.equal(service.signupCallOptions.length, 1)
  assert.deepEqual(service.signupCallOptions[0], { triggerRebalance: false })
  assert.equal(service.rebalanceCallCount, 1)
})
