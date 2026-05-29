import assert from 'node:assert/strict'
import test from 'node:test'

import { notificationQueue, subSelectionQueue } from '../../integrations/bull/queue.js'
import { prisma } from '../../shared/prisma.js'

import { DemoOrgAutofillService } from './demoOrgAutofillService.js'

const baseOccurrence = {
  id: 'occurrence-1',
  sessionId: 'session-1',
  startsAt: new Date('2026-05-26T18:00:00.000Z'),
  session: {
    leagueId: 'league-1',
    capacity: 10
  }
}

test.after(async () => {
  await notificationQueue.close()
  await subSelectionQueue.close()
  await prisma.$disconnect()
})

type AutofillServicePrivateMethods = {
  autofillRegistrations: (occurrence: typeof baseOccurrence) => Promise<{
    attemptedCount: number
    succeededCount: number
    failedCount: number
    existingAttendingCount: number
    targetCount: number
    skippedReason: string | null
  }>
  autofillSubs: (occurrence: typeof baseOccurrence) => Promise<{
    attemptedCount: number
    succeededCount: number
    failedCount: number
    existingActiveSelectedCount: number
    skippedReason: string | null
  }>
  resolveSubCandidateUserIds: (occurrence: typeof baseOccurrence) => Promise<string[]>
}

type AutofillServicePrivateDependencies = {
  registrationService: {
    register: (userId: string, occurrenceId: string) => Promise<void>
  }
  subSignupService: {
    signup: (userId: string, occurrenceId: string) => Promise<void>
  }
}

type DelegateFn<TArgs, TResult> = (args: TArgs) => Promise<TResult>

const withAutofillService = (): {
  service: DemoOrgAutofillService
  registeredUserIds: string[]
  signedUpUserIds: string[]
} => {
  const service = new DemoOrgAutofillService()
  const registeredUserIds: string[] = []
  const signedUpUserIds: string[] = []
  const dependencies = service as unknown as AutofillServicePrivateDependencies

  dependencies.registrationService = {
    register: async (userId) => {
      registeredUserIds.push(userId)
    }
  }
  dependencies.subSignupService = {
    signup: async (userId) => {
      signedUpUserIds.push(userId)
    }
  }

  return {
    service,
    registeredUserIds,
    signedUpUserIds
  }
}

test('autofillRegistrations excludes users already on app and still registers eligible users', async () => {
  const { service, registeredUserIds } = withAutofillService()
  const privateMethods = service as unknown as AutofillServicePrivateMethods
  const offAppUserId = 'off-app-user'
  const onAppUserId = 'on-app-user'
  const assignmentCandidates = [
    { userId: offAppUserId, isOnApp: false },
    { userId: onAppUserId, isOnApp: true }
  ]

  const sessionRegistrationDelegate = prisma.sessionRegistration as unknown as {
    count: DelegateFn<{ where: { occurrenceId: string; status: string } }, number>
  }
  const slotAssignmentDelegate = prisma.slotAssignment as unknown as {
    findMany: DelegateFn<
      {
        where: {
          leagueId: string
          sessionId: string
          user?: {
            isOnApp?: boolean
          }
        }
      },
      Array<{ userId: string }>
    >
  }
  const originalCount = sessionRegistrationDelegate.count
  const originalFindMany = slotAssignmentDelegate.findMany

  sessionRegistrationDelegate.count = async () => 0
  slotAssignmentDelegate.findMany = async (args) => {
    const isOnAppFilter = args.where.user?.isOnApp
    const filteredCandidates =
      isOnAppFilter === undefined
        ? assignmentCandidates
        : assignmentCandidates.filter((candidate) => candidate.isOnApp === isOnAppFilter)
    return filteredCandidates.map((candidate) => ({ userId: candidate.userId }))
  }

  try {
    const outcome = await privateMethods.autofillRegistrations(baseOccurrence)
    assert.deepEqual(registeredUserIds, [offAppUserId])
    assert.equal(outcome.attemptedCount, 1)
    assert.equal(outcome.succeededCount, 1)
    assert.equal(outcome.failedCount, 0)
  } finally {
    sessionRegistrationDelegate.count = originalCount
    slotAssignmentDelegate.findMany = originalFindMany
  }
})

test('autofillSubs excludes users already on app and still signs up eligible users', async () => {
  const { service, signedUpUserIds } = withAutofillService()
  const privateMethods = service as unknown as AutofillServicePrivateMethods
  const offAppUserId = 'off-app-user'
  const onAppUserId = 'on-app-user'
  const leagueMembers = [
    { userId: onAppUserId, isOnApp: true },
    { userId: offAppUserId, isOnApp: false }
  ]

  const subSignupDelegate = prisma.subSignup as unknown as {
    count: DelegateFn<
      {
        where: {
          occurrenceId: string
          status: {
            in: string[]
          }
        }
      },
      number
    >
    findMany: DelegateFn<
      {
        where: {
          occurrenceId?: string
          userId?: {
            in: string[]
          }
        }
      },
      Array<{ userId: string; occurrenceId?: string }>
    >
  }
  const leagueMembershipDelegate = prisma.leagueMembership as unknown as {
    findMany: DelegateFn<
      {
        where: {
          leagueId: string
          status: string
          user?: {
            isOnApp?: boolean
          }
        }
      },
      Array<{ userId: string }>
    >
  }
  const slotAssignmentDelegate = prisma.slotAssignment as unknown as {
    findMany: DelegateFn<{ where: { sessionId: string } }, Array<{ userId: string }>>
  }
  const sessionRegistrationDelegate = prisma.sessionRegistration as unknown as {
    findMany: DelegateFn<
      {
        where: {
          userId: {
            in: string[]
          }
        }
      },
      Array<{ userId: string }>
    >
  }

  const originalSubSignupCount = subSignupDelegate.count
  const originalSubSignupFindMany = subSignupDelegate.findMany
  const originalLeagueMembershipFindMany = leagueMembershipDelegate.findMany
  const originalSlotAssignmentFindMany = slotAssignmentDelegate.findMany
  const originalSessionRegistrationFindMany = sessionRegistrationDelegate.findMany

  subSignupDelegate.count = async () => 0
  subSignupDelegate.findMany = async (args) => {
    if (args.where.occurrenceId) {
      return []
    }

    return []
  }
  leagueMembershipDelegate.findMany = async (args) => {
    const isOnAppFilter = args.where.user?.isOnApp
    const filteredMembers =
      isOnAppFilter === undefined
        ? leagueMembers
        : leagueMembers.filter((member) => member.isOnApp === isOnAppFilter)
    return filteredMembers.map((member) => ({ userId: member.userId }))
  }
  slotAssignmentDelegate.findMany = async () => []
  sessionRegistrationDelegate.findMany = async () => []

  try {
    const outcome = await privateMethods.autofillSubs(baseOccurrence)
    assert.deepEqual(signedUpUserIds, [offAppUserId])
    assert.equal(signedUpUserIds.includes(onAppUserId), false)
    assert.equal(outcome.attemptedCount, 1)
    assert.equal(outcome.succeededCount, 1)
    assert.equal(outcome.failedCount, 0)
  } finally {
    subSignupDelegate.count = originalSubSignupCount
    subSignupDelegate.findMany = originalSubSignupFindMany
    leagueMembershipDelegate.findMany = originalLeagueMembershipFindMany
    slotAssignmentDelegate.findMany = originalSlotAssignmentFindMany
    sessionRegistrationDelegate.findMany = originalSessionRegistrationFindMany
  }
})

test('resolveSubCandidateUserIds keeps same-day conflict filtering while excluding on-app users', async () => {
  const { service } = withAutofillService()
  const privateMethods = service as unknown as AutofillServicePrivateMethods
  const offAppEligibleUserId = 'off-app-eligible'
  const offAppConflictUserId = 'off-app-conflict'
  const onAppUserId = 'on-app-user'
  const leagueMembers = [
    { userId: offAppEligibleUserId, isOnApp: false },
    { userId: offAppConflictUserId, isOnApp: false },
    { userId: onAppUserId, isOnApp: true }
  ]

  const leagueMembershipDelegate = prisma.leagueMembership as unknown as {
    findMany: DelegateFn<
      {
        where: {
          leagueId: string
          status: string
          user?: {
            isOnApp?: boolean
          }
        }
      },
      Array<{ userId: string }>
    >
  }
  const slotAssignmentDelegate = prisma.slotAssignment as unknown as {
    findMany: DelegateFn<{ where: { sessionId: string } }, Array<{ userId: string }>>
  }
  const subSignupDelegate = prisma.subSignup as unknown as {
    findMany: DelegateFn<
      {
        where: {
          occurrenceId?: string
          userId?: {
            in: string[]
          }
        }
      },
      Array<{ userId: string; occurrenceId?: string }>
    >
  }
  const sessionRegistrationDelegate = prisma.sessionRegistration as unknown as {
    findMany: DelegateFn<
      {
        where: {
          userId: {
            in: string[]
          }
        }
      },
      Array<{ userId: string }>
    >
  }
  const originalLeagueMembershipFindMany = leagueMembershipDelegate.findMany
  const originalSlotAssignmentFindMany = slotAssignmentDelegate.findMany
  const originalSubSignupFindMany = subSignupDelegate.findMany
  const originalSessionRegistrationFindMany = sessionRegistrationDelegate.findMany

  leagueMembershipDelegate.findMany = async (args) => {
    const isOnAppFilter = args.where.user?.isOnApp
    const filteredMembers =
      isOnAppFilter === undefined
        ? leagueMembers
        : leagueMembers.filter((member) => member.isOnApp === isOnAppFilter)
    return filteredMembers.map((member) => ({ userId: member.userId }))
  }
  slotAssignmentDelegate.findMany = async () => []
  subSignupDelegate.findMany = async () => []
  sessionRegistrationDelegate.findMany = async (args) => {
    const candidateUserIds = args.where.userId.in
    const hasConflictCandidate = candidateUserIds.includes(offAppConflictUserId)
    if (!hasConflictCandidate) {
      return []
    }

    return [{ userId: offAppConflictUserId }]
  }

  try {
    const candidateUserIds = await privateMethods.resolveSubCandidateUserIds(baseOccurrence)
    assert.deepEqual(candidateUserIds, [offAppEligibleUserId])
  } finally {
    leagueMembershipDelegate.findMany = originalLeagueMembershipFindMany
    slotAssignmentDelegate.findMany = originalSlotAssignmentFindMany
    subSignupDelegate.findMany = originalSubSignupFindMany
    sessionRegistrationDelegate.findMany = originalSessionRegistrationFindMany
  }
})
