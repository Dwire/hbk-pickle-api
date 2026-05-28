import assert from 'node:assert/strict'
import test from 'node:test'

import { GraphQLError } from 'graphql'

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

class NonRebalancingSubSignupService extends SubSignupService {
  protected override shouldTriggerRebalance(): boolean {
    return false
  }

  protected override async rebalanceOccurrence(): Promise<void> {
    // no-op for tests
  }
}

const activeOccurrence = {
  id: occurrenceId,
  status: activeOccurrenceStatus,
  startsAt: new Date(startsAtIso),
  endsAt: new Date(endsAtIso),
  session: { leagueId: 'league-1' },
  sessionId: 'session-1'
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

test('signup fails with BAD_USER_INPUT reason when active registration already exists for same occurrence', async (t) => {
  const service = new NonRebalancingSubSignupService()

  const sessionServicePrototype = SessionService.prototype as unknown as {
    isWithinSubSignupWindow: (now: Date, endsAt: Date) => boolean
  }
  const sessionOccurrenceDelegate = prisma.sessionOccurrence as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const leagueMembershipDelegate = prisma.leagueMembership as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const slotAssignmentDelegate = prisma.slotAssignment as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const registrationDelegate = prisma.sessionRegistration as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
    findFirst: (...args: unknown[]) => Promise<unknown>
  }
  const subSignupDelegate = prisma.subSignup as unknown as {
    findFirst: (...args: unknown[]) => Promise<unknown>
  }

  const originalIsWithinSubSignupWindow = sessionServicePrototype.isWithinSubSignupWindow
  const originalOccurrenceFindUnique = sessionOccurrenceDelegate.findUnique
  const originalLeagueMembershipFindUnique = leagueMembershipDelegate.findUnique
  const originalSlotAssignmentFindUnique = slotAssignmentDelegate.findUnique
  const originalRegistrationFindUnique = registrationDelegate.findUnique
  const originalRegistrationFindFirst = registrationDelegate.findFirst
  const originalSubSignupFindFirst = subSignupDelegate.findFirst

  sessionServicePrototype.isWithinSubSignupWindow = () => true
  sessionOccurrenceDelegate.findUnique = async () => activeOccurrence
  leagueMembershipDelegate.findUnique = async () => ({ status: 'ACTIVE' })
  slotAssignmentDelegate.findUnique = async () => null
  registrationDelegate.findUnique = async () => ({ status: 'ATTENDING' })
  registrationDelegate.findFirst = async () => ({
    id: 'reg-1',
    occurrenceId
  })
  subSignupDelegate.findFirst = async () => null

  t.after(() => {
    sessionServicePrototype.isWithinSubSignupWindow = originalIsWithinSubSignupWindow
    sessionOccurrenceDelegate.findUnique = originalOccurrenceFindUnique
    leagueMembershipDelegate.findUnique = originalLeagueMembershipFindUnique
    slotAssignmentDelegate.findUnique = originalSlotAssignmentFindUnique
    registrationDelegate.findUnique = originalRegistrationFindUnique
    registrationDelegate.findFirst = originalRegistrationFindFirst
    subSignupDelegate.findFirst = originalSubSignupFindFirst
  })

  await assert.rejects(
    () => service.signup(userId, occurrenceId),
    (error: unknown) => {
      assert.ok(error instanceof GraphQLError)
      assert.equal(error.extensions.code, 'BAD_USER_INPUT')
      assert.equal(error.extensions.reason, 'REGISTRATION_ALREADY_ACTIVE')
      return true
    }
  )
})

test('signup keeps same-day other-occurrence conflict behavior', async (t) => {
  const service = new NonRebalancingSubSignupService()

  const sessionServicePrototype = SessionService.prototype as unknown as {
    isWithinSubSignupWindow: (now: Date, endsAt: Date) => boolean
  }
  const sessionOccurrenceDelegate = prisma.sessionOccurrence as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const leagueMembershipDelegate = prisma.leagueMembership as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const slotAssignmentDelegate = prisma.slotAssignment as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const registrationDelegate = prisma.sessionRegistration as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
    findFirst: (...args: unknown[]) => Promise<unknown>
  }
  const subSignupDelegate = prisma.subSignup as unknown as {
    findFirst: (...args: unknown[]) => Promise<unknown>
  }

  const originalIsWithinSubSignupWindow = sessionServicePrototype.isWithinSubSignupWindow
  const originalOccurrenceFindUnique = sessionOccurrenceDelegate.findUnique
  const originalLeagueMembershipFindUnique = leagueMembershipDelegate.findUnique
  const originalSlotAssignmentFindUnique = slotAssignmentDelegate.findUnique
  const originalRegistrationFindUnique = registrationDelegate.findUnique
  const originalRegistrationFindFirst = registrationDelegate.findFirst
  const originalSubSignupFindFirst = subSignupDelegate.findFirst

  sessionServicePrototype.isWithinSubSignupWindow = () => true
  sessionOccurrenceDelegate.findUnique = async () => activeOccurrence
  leagueMembershipDelegate.findUnique = async () => ({ status: 'ACTIVE' })
  slotAssignmentDelegate.findUnique = async () => null
  registrationDelegate.findUnique = async () => null
  registrationDelegate.findFirst = async () => ({
    id: 'reg-other',
    occurrenceId: 'occ-2'
  })
  subSignupDelegate.findFirst = async () => null

  t.after(() => {
    sessionServicePrototype.isWithinSubSignupWindow = originalIsWithinSubSignupWindow
    sessionOccurrenceDelegate.findUnique = originalOccurrenceFindUnique
    leagueMembershipDelegate.findUnique = originalLeagueMembershipFindUnique
    slotAssignmentDelegate.findUnique = originalSlotAssignmentFindUnique
    registrationDelegate.findUnique = originalRegistrationFindUnique
    registrationDelegate.findFirst = originalRegistrationFindFirst
    subSignupDelegate.findFirst = originalSubSignupFindFirst
  })

  await assert.rejects(
    () => service.signup(userId, occurrenceId),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'User already registered for a session that day')
      return true
    }
  )
})

test('signup prioritizes same-occurrence conflict when multiple same-day registrations exist', async (t) => {
  const service = new NonRebalancingSubSignupService()

  const sessionServicePrototype = SessionService.prototype as unknown as {
    isWithinSubSignupWindow: (now: Date, endsAt: Date) => boolean
  }
  const sessionOccurrenceDelegate = prisma.sessionOccurrence as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const leagueMembershipDelegate = prisma.leagueMembership as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const slotAssignmentDelegate = prisma.slotAssignment as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const registrationDelegate = prisma.sessionRegistration as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
    findFirst: (...args: unknown[]) => Promise<unknown>
  }
  const subSignupDelegate = prisma.subSignup as unknown as {
    findFirst: (...args: unknown[]) => Promise<unknown>
  }

  const originalIsWithinSubSignupWindow = sessionServicePrototype.isWithinSubSignupWindow
  const originalOccurrenceFindUnique = sessionOccurrenceDelegate.findUnique
  const originalLeagueMembershipFindUnique = leagueMembershipDelegate.findUnique
  const originalSlotAssignmentFindUnique = slotAssignmentDelegate.findUnique
  const originalRegistrationFindUnique = registrationDelegate.findUnique
  const originalRegistrationFindFirst = registrationDelegate.findFirst
  const originalSubSignupFindFirst = subSignupDelegate.findFirst

  sessionServicePrototype.isWithinSubSignupWindow = () => true
  sessionOccurrenceDelegate.findUnique = async () => activeOccurrence
  leagueMembershipDelegate.findUnique = async () => ({ status: 'ACTIVE' })
  slotAssignmentDelegate.findUnique = async () => null
  registrationDelegate.findUnique = async () => ({ status: 'ATTENDING' })
  registrationDelegate.findFirst = async () => ({
    id: 'reg-other',
    occurrenceId: 'occ-2'
  })
  subSignupDelegate.findFirst = async () => null

  t.after(() => {
    sessionServicePrototype.isWithinSubSignupWindow = originalIsWithinSubSignupWindow
    sessionOccurrenceDelegate.findUnique = originalOccurrenceFindUnique
    leagueMembershipDelegate.findUnique = originalLeagueMembershipFindUnique
    slotAssignmentDelegate.findUnique = originalSlotAssignmentFindUnique
    registrationDelegate.findUnique = originalRegistrationFindUnique
    registrationDelegate.findFirst = originalRegistrationFindFirst
    subSignupDelegate.findFirst = originalSubSignupFindFirst
  })

  await assert.rejects(
    () => service.signup(userId, occurrenceId),
    (error: unknown) => {
      assert.ok(error instanceof GraphQLError)
      assert.equal(error.extensions.code, 'BAD_USER_INPUT')
      assert.equal(error.extensions.reason, 'REGISTRATION_ALREADY_ACTIVE')
      return true
    }
  )
})

test('signup succeeds after registration is canceled', async (t) => {
  const service = new NonRebalancingSubSignupService()
  let registrationFindFirstArgs: unknown[] = []

  const sessionServicePrototype = SessionService.prototype as unknown as {
    isWithinSubSignupWindow: (now: Date, endsAt: Date) => boolean
  }
  const sessionOccurrenceDelegate = prisma.sessionOccurrence as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const leagueMembershipDelegate = prisma.leagueMembership as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const slotAssignmentDelegate = prisma.slotAssignment as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const registrationDelegate = prisma.sessionRegistration as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
    findFirst: (...args: unknown[]) => Promise<unknown>
  }
  const subSignupDelegate = prisma.subSignup as unknown as {
    findFirst: (...args: unknown[]) => Promise<unknown>
    findUnique: (...args: unknown[]) => Promise<unknown>
    create: (...args: unknown[]) => Promise<unknown>
  }

  const originalIsWithinSubSignupWindow = sessionServicePrototype.isWithinSubSignupWindow
  const originalOccurrenceFindUnique = sessionOccurrenceDelegate.findUnique
  const originalLeagueMembershipFindUnique = leagueMembershipDelegate.findUnique
  const originalSlotAssignmentFindUnique = slotAssignmentDelegate.findUnique
  const originalRegistrationFindUnique = registrationDelegate.findUnique
  const originalRegistrationFindFirst = registrationDelegate.findFirst
  const originalSubSignupFindFirst = subSignupDelegate.findFirst
  const originalSubSignupFindUnique = subSignupDelegate.findUnique
  const originalSubSignupCreate = subSignupDelegate.create

  sessionServicePrototype.isWithinSubSignupWindow = () => true
  sessionOccurrenceDelegate.findUnique = async () => activeOccurrence
  leagueMembershipDelegate.findUnique = async () => ({ status: 'ACTIVE' })
  slotAssignmentDelegate.findUnique = async () => null
  registrationDelegate.findUnique = async () => ({ status: 'CANCELED' })
  registrationDelegate.findFirst = async (...args: unknown[]) => {
    registrationFindFirstArgs = args
    return null
  }
  subSignupDelegate.findFirst = async () => null
  subSignupDelegate.findUnique = async () => null
  subSignupDelegate.create = async () => ({
    id: ensuredSignupId,
    userId,
    occurrenceId,
    status: 'ACTIVE',
    signedUpAt: new Date()
  })

  t.after(() => {
    sessionServicePrototype.isWithinSubSignupWindow = originalIsWithinSubSignupWindow
    sessionOccurrenceDelegate.findUnique = originalOccurrenceFindUnique
    leagueMembershipDelegate.findUnique = originalLeagueMembershipFindUnique
    slotAssignmentDelegate.findUnique = originalSlotAssignmentFindUnique
    registrationDelegate.findUnique = originalRegistrationFindUnique
    registrationDelegate.findFirst = originalRegistrationFindFirst
    subSignupDelegate.findFirst = originalSubSignupFindFirst
    subSignupDelegate.findUnique = originalSubSignupFindUnique
    subSignupDelegate.create = originalSubSignupCreate
  })

  const result = await service.signup(userId, occurrenceId)

  const [registrationQuery] = registrationFindFirstArgs as [
    { where?: { status?: string } }
  ]
  assert.equal(registrationQuery.where?.status, 'ATTENDING')
  assert.equal(result.status, 'ACTIVE')
  assert.equal(result.occurrenceId, occurrenceId)
})
