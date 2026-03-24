import type { LeagueStatus, RegistrationStatus, SubSignupStatus, Weekday } from '../generated/prisma/client.js'
import { logger } from '../shared/logger.js'
import { prisma } from '../shared/prisma.js'
import {
  easternDayMinutesToUtc,
  easternZonedTimeToUtc,
  getEasternWeekRangeUtc,
  shiftDateByDays,
  type DateParts
} from '../shared/time.js'

const hbkPickleOrganizationName = 'HBK Pickle'
const hbkPickleOrganizationSlug = 'hbk-pickle'
const legacyHbkOrganizationSlug = 'hbk-rec-league'
const demoOrganizationName = 'Demo Org'
const demoOrganizationSlug = 'demo-org'

const seedLeagueNamePrefix = 'Seed League'
const seedLeagueTimeZone = 'America/New_York'

const seedPhonePrefix = '+155500000'
const seedPhoneStart = 1
const seedPhoneEnd = 99
const seedPhoneSuffixWidth = 2

const playersPerSession = 5
const sessionsPerDay = 3

const minutesPerHour = 60
const sessionDurationMinutes = 90
const firstSessionStartHour = 18
const secondSessionStartHour = 20
const thirdSessionStartHour = 22
const sessionStartMinute = 0
const daysInWeek = 7
const randomRegistrationMin = 1
const randomRegistrationMax = 5
const randomSubSignupMin = 3
const randomSubSignupMax = 10

const leagueGapWeeks = 1
const firstPastLeagueDurationWeeks = 8
const secondPastLeagueDurationWeeks = 10
const currentLeagueDurationWeeks = 12

const secondPastLeagueStartOffsetWeeks = -(secondPastLeagueDurationWeeks + leagueGapWeeks)
const firstPastLeagueStartOffsetWeeks = secondPastLeagueStartOffsetWeeks - (firstPastLeagueDurationWeeks + leagueGapWeeks)
const currentLeagueStartOffsetWeeks = 0

const protectedUsers = [
  {
    id: '714415e3-5239-4db0-9800-add7cc45c4c9',
    phoneNumber: '+1555990000',
    displayName: 'Seed Protected Player'
  },
  {
    id: 'ca463e7b-f880-4c0d-bcc1-0f6eb06871cb',
    phoneNumber: '+12019068870',
    displayName: 'Elma Crabbe'
  }
] as const

const protectedUserIds: ReadonlySet<string> = new Set(protectedUsers.map((user) => user.id))

const seedFirstNames = [
  'Avery',
  'Cameron',
  'Jordan',
  'Taylor',
  'Morgan',
  'Riley',
  'Casey',
  'Skyler',
  'Parker',
  'Rowan',
  'Quinn',
  'Elliot',
  'Hayden',
  'Reese',
  'Logan',
  'Finley',
  'Sage',
  'Payton',
  'Drew',
  'Harper'
] as const

const seedLastNames = [
  'Abbott',
  'Bennett',
  'Caldwell',
  'Dawson',
  'Ellison',
  'Foster',
  'Garrett',
  'Harrison',
  'Iverson',
  'Jensen',
  'Keller',
  'Lawson',
  'Morrison',
  'Nolan',
  'Owens',
  'Prescott',
  'Quigley',
  'Ramsey',
  'Sullivan',
  'Turner'
] as const

const registrationStatusAttending: RegistrationStatus = 'ATTENDING'
const subSignupStatusActive: SubSignupStatus = 'ACTIVE'

const seedWeekdays: Weekday[] = ['MONDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']

type SessionTimeConfig = {
  label: string
  startMinutes: number
  endMinutes: number
}

type SessionTemplateConfig = {
  title: string
  weekday: Weekday
  startTimeMinutes: number
  endTimeMinutes: number
  capacity: number
}

type LeagueRuleSeed = {
  title: string
  body: string
  order: number
}

type LeagueSeedConfig = {
  name: string
  status: LeagueStatus
  startDateParts: DateParts
  durationWeeks: number
}

type LeagueSeedDefinition = {
  name: string
  status: LeagueStatus
  durationWeeks: number
  startWeekOffset: number
}

type AssignmentSeed = {
  leagueId: string
  sessionId: string
  userId: string
}

const sessionTimeConfigs: SessionTimeConfig[] = [
  {
    label: 'Early',
    startMinutes: firstSessionStartHour * minutesPerHour + sessionStartMinute,
    endMinutes: firstSessionStartHour * minutesPerHour + sessionStartMinute + sessionDurationMinutes
  },
  {
    label: 'Mid',
    startMinutes: secondSessionStartHour * minutesPerHour + sessionStartMinute,
    endMinutes: secondSessionStartHour * minutesPerHour + sessionStartMinute + sessionDurationMinutes
  },
  {
    label: 'Late',
    startMinutes: thirdSessionStartHour * minutesPerHour + sessionStartMinute,
    endMinutes: thirdSessionStartHour * minutesPerHour + sessionStartMinute + sessionDurationMinutes
  }
]

const leagueSeedDefinitions: LeagueSeedDefinition[] = [
  {
    name: `${seedLeagueNamePrefix} Past 1`,
    status: 'ARCHIVED',
    durationWeeks: firstPastLeagueDurationWeeks,
    startWeekOffset: firstPastLeagueStartOffsetWeeks
  },
  {
    name: `${seedLeagueNamePrefix} Past 2`,
    status: 'ARCHIVED',
    durationWeeks: secondPastLeagueDurationWeeks,
    startWeekOffset: secondPastLeagueStartOffsetWeeks
  },
  {
    name: `${seedLeagueNamePrefix} Current`,
    status: 'ACTIVE',
    durationWeeks: currentLeagueDurationWeeks,
    startWeekOffset: currentLeagueStartOffsetWeeks
  }
]

const weekdayIndexMap: Record<Weekday, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 0
}

const buildSessionTemplates = (): SessionTemplateConfig[] =>
  seedWeekdays.flatMap((weekday) =>
    sessionTimeConfigs.map((timeConfig) => ({
      title: `${weekday} ${timeConfig.label}`,
      weekday,
      startTimeMinutes: timeConfig.startMinutes,
      endTimeMinutes: timeConfig.endMinutes,
      capacity: playersPerSession
    }))
  )

const getSeedGeneratedUserCount = (sessionTemplates: SessionTemplateConfig[]) =>
  sessionTemplates.length * playersPerSession - protectedUsers.length

const getSeedName = (index: number): string => {
  const firstName = seedFirstNames[index % seedFirstNames.length]
  const lastNameIndex = Math.floor(index / seedFirstNames.length) % seedLastNames.length
  const lastName = seedLastNames[lastNameIndex]
  return `${firstName} ${lastName}`
}

const isSeedPhoneNumber = (phoneNumber: string): boolean => {
  if (!phoneNumber.startsWith(seedPhonePrefix)) {
    return false
  }

  const suffix = phoneNumber.slice(seedPhonePrefix.length)
  if (suffix.length !== seedPhoneSuffixWidth) {
    return false
  }

  const numericSuffix = Number(suffix)
  return Number.isInteger(numericSuffix) && numericSuffix >= seedPhoneStart && numericSuffix <= seedPhoneEnd
}

const ensureSeedCounts = (sessionTemplates: SessionTemplateConfig[]) => {
  const seedGeneratedUserCount = getSeedGeneratedUserCount(sessionTemplates)
  const expectedTemplateCount = seedWeekdays.length * sessionsPerDay
  const maxSeedPhoneCount = seedPhoneEnd - seedPhoneStart + 1
  const maxUniqueSeedNames = seedFirstNames.length * seedLastNames.length
  const activeLeagueCount = leagueSeedDefinitions.filter((league) => league.status === 'ACTIVE').length

  if (seedGeneratedUserCount <= 0) {
    throw new Error('Seed user count must be greater than zero after reserving protected users')
  }

  if (seedGeneratedUserCount > maxSeedPhoneCount) {
    throw new Error(`Seed user count exceeds available seeded phone range of ${String(maxSeedPhoneCount)} users`)
  }

  if (seedGeneratedUserCount > maxUniqueSeedNames) {
    throw new Error(`Seed user count exceeds available deterministic seed name combinations of ${String(maxUniqueSeedNames)}`)
  }

  if (sessionTemplates.length !== expectedTemplateCount) {
    throw new Error(
      `Seed must define exactly ${String(expectedTemplateCount)} session templates (${String(sessionsPerDay)} per day)`
    )
  }

  if (activeLeagueCount !== 1) {
    throw new Error('Seed league definitions must include exactly one ACTIVE league')
  }

  for (const weekday of seedWeekdays) {
    const weekdayTemplateCount = sessionTemplates.filter((template) => template.weekday === weekday).length
    if (weekdayTemplateCount !== sessionsPerDay) {
      throw new Error(`Seed must define exactly ${String(sessionsPerDay)} sessions for ${weekday}`)
    }
  }
}

const getCurrentWeekStartDateParts = (): DateParts => {
  const { start } = getEasternWeekRangeUtc(new Date())
  return {
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
    day: start.getUTCDate()
  }
}

const buildLeagueSeedConfigs = (currentWeekStartDateParts: DateParts): LeagueSeedConfig[] =>
  leagueSeedDefinitions.map((league) => ({
    name: league.name,
    status: league.status,
    durationWeeks: league.durationWeeks,
    startDateParts: shiftDateByDays(currentWeekStartDateParts, league.startWeekOffset * daysInWeek)
  }))

const buildUserData = (seedGeneratedUserCount: number) =>
  Array.from({ length: seedGeneratedUserCount }, (_, index) => {
    const suffix = String(seedPhoneStart + index).padStart(seedPhoneSuffixWidth, '0')
    return {
      phoneNumber: `${seedPhonePrefix}${suffix}`,
      displayName: getSeedName(index),
      isOnApp: true
    }
  })

const buildLeagueRules = (leagueId: string) => {
  const rules: LeagueRuleSeed[] = [
    {
      order: 1,
      title: 'Registration Required',
      body: 'Players must be registered for indoor pickleball to participate in any session.'
    },
    {
      order: 2,
      title: 'Session Capacity',
      body: 'A maximum of 16-18 players per session (Monday 7am - 19 players).'
    },
    {
      order: 3,
      title: 'Subbing',
      body:
        'Players may sub in when spots are available due to sickness or absence, but no swapping spots during a session. Permanent swaps are only allowed at the start of a season with a valid excuse.'
    },
    {
      order: 4,
      title: 'Session Limit',
      body: 'Players are allowed to participate in only one session per day, even if subbing.'
    },
    {
      order: 5,
      title: 'Equipment',
      body: 'Players must bring their own paddles. The city will provide the balls.'
    },
    {
      order: 6,
      title: 'Game Rotation',
      body:
        '- Winners stay and split to play a second game, then rotate from the paddle rack.\n- Losers rotate from the paddle rack.'
    },
    {
      order: 7,
      title: 'Morning Session Duty',
      body: 'Players in the early morning session are responsible for helping monitors set up the nets and prepare the space.'
    },
    {
      order: 8,
      title: 'Afternoon Session Duty',
      body: 'Players in the last session are responsible for helping monitors store the equipment.'
    },
    {
      order: 9,
      title: 'Court Issues',
      body: 'Any questions, concerns, or issues on the courts must be addressed to the monitors on site.'
    },
    {
      order: 10,
      title: 'Injury Reporting',
      body:
        'Any injury requiring ice, band-aids, or medical attention must be reported to the monitor before leaving the gym. An accident report must also be filled out.'
    },
    {
      order: 11,
      title: 'Spectators',
      body: 'No children or adult spectators are allowed in the gym during pickleball games.'
    }
  ]

  return rules.map((rule) => ({
    leagueId,
    title: rule.title,
    body: rule.body,
    order: rule.order
  }))
}

const buildOccurrenceDates = (
  baseWeekStartDateParts: DateParts,
  durationWeeks: number,
  weekday: Weekday,
  startMinutes: number,
  endMinutes: number
) =>
  Array.from({ length: durationWeeks }, (_, weekIndex) => {
    const dayOffset = weekdayIndexMap[weekday] - weekdayIndexMap.MONDAY
    const dayStart = shiftDateByDays(baseWeekStartDateParts, weekIndex * daysInWeek + dayOffset)
    const startsAt = easternDayMinutesToUtc(dayStart, startMinutes)
    const endsAt = easternDayMinutesToUtc(dayStart, endMinutes)
    return { startsAt, endsAt }
  })

const toEasternMidnightUtc = (dateParts: DateParts): Date =>
  easternZonedTimeToUtc({
    ...dateParts,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  })

const getRandomIntInclusive = (minimum: number, maximum: number): number =>
  Math.floor(Math.random() * (maximum - minimum + 1)) + minimum

const shuffleValues = <T>(values: T[]): T[] => {
  const copy = [...values]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const currentValue = copy[index]
    copy[index] = copy[swapIndex]
    copy[swapIndex] = currentValue
  }

  return copy
}

const pickRandomValues = <T>(values: T[], count: number): T[] => {
  if (count <= 0 || values.length === 0) {
    return []
  }

  const maxCount = Math.min(values.length, count)
  return shuffleValues(values).slice(0, maxCount)
}

const deleteLeagueGraph = async (leagueIds: string[]) => {
  if (leagueIds.length === 0) {
    return
  }

  const sessions = await prisma.session.findMany({
    where: { leagueId: { in: leagueIds } },
    select: { id: true }
  })
  const sessionIds = sessions.map((session) => session.id)

  const occurrences = sessionIds.length
    ? await prisma.sessionOccurrence.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { id: true }
      })
    : []
  const occurrenceIds = occurrences.map((occurrence) => occurrence.id)

  if (occurrenceIds.length > 0) {
    await prisma.notification.deleteMany({ where: { occurrenceId: { in: occurrenceIds } } })
    await prisma.subSignup.deleteMany({ where: { occurrenceId: { in: occurrenceIds } } })
    await prisma.sessionRegistration.deleteMany({ where: { occurrenceId: { in: occurrenceIds } } })
  }

  await prisma.slotAssignment.deleteMany({ where: { leagueId: { in: leagueIds } } })
  await prisma.leagueMembership.deleteMany({ where: { leagueId: { in: leagueIds } } })
  await prisma.leagueRule.deleteMany({ where: { leagueId: { in: leagueIds } } })

  if (sessionIds.length > 0) {
    await prisma.sessionOccurrence.deleteMany({ where: { sessionId: { in: sessionIds } } })
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
  }

  await prisma.league.deleteMany({ where: { id: { in: leagueIds } } })
}

const deleteOrganizationAndDependencies = async (organizationId: string) => {
  const leagues = await prisma.league.findMany({
    where: { organizationId },
    select: { id: true }
  })

  await deleteLeagueGraph(leagues.map((league) => league.id))
  await prisma.organizationMembership.deleteMany({ where: { organizationId } })
  await prisma.organization.delete({ where: { id: organizationId } })
}

const ensureOrganizations = async () => {
  const legacyOrganization = await prisma.organization.findUnique({ where: { slug: legacyHbkOrganizationSlug } })
  const canonicalHbkOrganization = await prisma.organization.findUnique({ where: { slug: hbkPickleOrganizationSlug } })

  if (legacyOrganization && canonicalHbkOrganization) {
    await deleteOrganizationAndDependencies(legacyOrganization.id)
    logger.info({ removedOrganizationId: legacyOrganization.id }, 'Removed legacy HBK organization after slug migration')
  }

  const hbkOrganization = legacyOrganization && !canonicalHbkOrganization
    ? await prisma.organization.update({
        where: { id: legacyOrganization.id },
        data: {
          name: hbkPickleOrganizationName,
          slug: hbkPickleOrganizationSlug
        }
      })
    : await prisma.organization.upsert({
        where: { slug: hbkPickleOrganizationSlug },
        create: {
          name: hbkPickleOrganizationName,
          slug: hbkPickleOrganizationSlug
        },
        update: {
          name: hbkPickleOrganizationName
        }
      })

  const demoOrganization = await prisma.organization.upsert({
    where: { slug: demoOrganizationSlug },
    create: {
      name: demoOrganizationName,
      slug: demoOrganizationSlug
    },
    update: {
      name: demoOrganizationName
    }
  })

  return { hbkOrganization, demoOrganization }
}

const ensureProtectedUsers = async () => {
  const users = []

  for (const protectedUser of protectedUsers) {
    const user = await prisma.user.upsert({
      where: { id: protectedUser.id },
      create: {
        id: protectedUser.id,
        phoneNumber: protectedUser.phoneNumber,
        displayName: protectedUser.displayName,
        isOnApp: true
      },
      update: {
        phoneNumber: protectedUser.phoneNumber,
        displayName: protectedUser.displayName,
        isOnApp: true
      }
    })

    users.push(user)
  }

  return users
}

const findSeededUsers = async () => {
  const users = await prisma.user.findMany({
    where: {
      phoneNumber: {
        startsWith: seedPhonePrefix
      }
    },
    select: {
      id: true,
      phoneNumber: true
    }
  })

  return users.filter((user) => isSeedPhoneNumber(user.phoneNumber) && !protectedUserIds.has(user.id))
}

const clearSeededUserData = async (seededUserIds: string[]) => {
  if (seededUserIds.length === 0) {
    return
  }

  const notificationResult = await prisma.notification.deleteMany({ where: { userId: { in: seededUserIds } } })
  logger.info({ count: notificationResult.count }, 'Cleared seeded-user notifications')

  const subSignupResult = await prisma.subSignup.deleteMany({ where: { userId: { in: seededUserIds } } })
  logger.info({ count: subSignupResult.count }, 'Cleared seeded-user sub signups')

  const registrationResult = await prisma.sessionRegistration.deleteMany({ where: { userId: { in: seededUserIds } } })
  logger.info({ count: registrationResult.count }, 'Cleared seeded-user session registrations')

  const assignmentResult = await prisma.slotAssignment.deleteMany({ where: { userId: { in: seededUserIds } } })
  logger.info({ count: assignmentResult.count }, 'Cleared seeded-user slot assignments')

  const leagueMembershipResult = await prisma.leagueMembership.deleteMany({ where: { userId: { in: seededUserIds } } })
  logger.info({ count: leagueMembershipResult.count }, 'Cleared seeded-user league memberships')

  const organizationMembershipResult = await prisma.organizationMembership.deleteMany({
    where: { userId: { in: seededUserIds } }
  })
  logger.info({ count: organizationMembershipResult.count }, 'Cleared seeded-user organization memberships')

  const deviceResult = await prisma.userDevice.deleteMany({ where: { userId: { in: seededUserIds } } })
  logger.info({ count: deviceResult.count }, 'Cleared seeded-user devices')

  const userResult = await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } })
  logger.info({ count: userResult.count }, 'Cleared seeded users')
}

const clearDemoOrganizationLeagues = async (organizationId: string) => {
  const leagues = await prisma.league.findMany({
    where: { organizationId },
    select: { id: true }
  })

  await deleteLeagueGraph(leagues.map((league) => league.id))
}

const ensureProtectedOwners = async (
  organizationIds: string[],
  users: { id: string }[]
) => {
  for (const organizationId of organizationIds) {
    for (const user of users) {
      await prisma.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId,
            userId: user.id
          }
        },
        create: {
          organizationId,
          userId: user.id,
          role: 'OWNER'
        },
        update: {
          role: 'OWNER'
        }
      })
    }
  }
}

const buildLeagueAssignments = (
  leagueId: string,
  sessions: { id: string }[],
  users: { id: string }[]
): AssignmentSeed[] => {
  const assignments = sessions.flatMap((session, sessionIndex) => {
    const startIndex = sessionIndex * playersPerSession
    const assignedUsers = users.slice(startIndex, startIndex + playersPerSession)

    if (assignedUsers.length !== playersPerSession) {
      throw new Error('Not enough users to assign five players to each session')
    }

    return assignedUsers.map((user) => ({
      leagueId,
      sessionId: session.id,
      userId: user.id
    }))
  })

  const assignmentUserCount = new Set(assignments.map((assignment) => assignment.userId)).size
  if (assignmentUserCount !== assignments.length) {
    throw new Error('A user was assigned to more than one session within the same league')
  }

  return assignments
}

const backfillPastOccurrenceActivity = async (
  occurrences: { id: string; sessionId: string; startsAt: Date }[],
  assignments: AssignmentSeed[],
  allUserIds: string[]
) => {
  const now = new Date()
  const pastOccurrences = occurrences.filter((occurrence) => occurrence.startsAt < now)

  if (pastOccurrences.length === 0) {
    return { registrationCount: 0, subSignupCount: 0 }
  }

  const assignedUserIdsBySessionId = new Map<string, string[]>()
  assignments.forEach((assignment) => {
    const existing = assignedUserIdsBySessionId.get(assignment.sessionId) ?? []
    existing.push(assignment.userId)
    assignedUserIdsBySessionId.set(assignment.sessionId, existing)
  })

  const registrationsToCreate: { userId: string; occurrenceId: string; status: RegistrationStatus }[] = []
  const subSignupsToCreate: { userId: string; occurrenceId: string; status: SubSignupStatus }[] = []

  for (const occurrence of pastOccurrences) {
    const assignedUserIds = assignedUserIdsBySessionId.get(occurrence.sessionId) ?? []
    const desiredRegistrationCount = getRandomIntInclusive(randomRegistrationMin, randomRegistrationMax)
    const registeredUserIds = pickRandomValues(assignedUserIds, desiredRegistrationCount)

    registeredUserIds.forEach((userId) => {
      registrationsToCreate.push({
        userId,
        occurrenceId: occurrence.id,
        status: registrationStatusAttending
      })
    })

    const unavailableForSubs = new Set(assignedUserIds)
    registeredUserIds.forEach((userId) => unavailableForSubs.add(userId))

    const subPoolUserIds = allUserIds.filter((userId) => !unavailableForSubs.has(userId))
    const desiredSubSignupCount = getRandomIntInclusive(randomSubSignupMin, randomSubSignupMax)
    const subSignupUserIds = pickRandomValues(subPoolUserIds, desiredSubSignupCount)

    subSignupUserIds.forEach((userId) => {
      subSignupsToCreate.push({
        userId,
        occurrenceId: occurrence.id,
        status: subSignupStatusActive
      })
    })
  }

  if (registrationsToCreate.length > 0) {
    await prisma.sessionRegistration.createMany({ data: registrationsToCreate })
  }

  if (subSignupsToCreate.length > 0) {
    await prisma.subSignup.createMany({ data: subSignupsToCreate })
  }

  return {
    registrationCount: registrationsToCreate.length,
    subSignupCount: subSignupsToCreate.length
  }
}

const seedDemoOrganizationLeagues = async (organizationId: string, users: { id: string }[]) => {
  const sessionTemplates = buildSessionTemplates()
  ensureSeedCounts(sessionTemplates)

  const currentWeekStartDateParts = getCurrentWeekStartDateParts()
  const leagueSeedConfigs = buildLeagueSeedConfigs(currentWeekStartDateParts)
  const allUserIds = users.map((user) => user.id)

  let totalSessionCount = 0
  let totalOccurrenceCount = 0
  let totalAssignmentCount = 0
  let totalRegistrationCount = 0
  let totalSubSignupCount = 0

  for (const leagueConfig of leagueSeedConfigs) {
    const leagueEndDateParts = shiftDateByDays(leagueConfig.startDateParts, daysInWeek * leagueConfig.durationWeeks)

    const league = await prisma.league.create({
      data: {
        organizationId,
        name: leagueConfig.name,
        timeZone: seedLeagueTimeZone,
        startDate: toEasternMidnightUtc(leagueConfig.startDateParts),
        endDate: toEasternMidnightUtc(leagueEndDateParts),
        status: leagueConfig.status
      }
    })

    const leagueRules = buildLeagueRules(league.id)
    if (leagueRules.length > 0) {
      await prisma.leagueRule.createMany({ data: leagueRules })
    }

    const sessions = await Promise.all(
      sessionTemplates.map((template) =>
        prisma.session.create({
          data: {
            leagueId: league.id,
            title: template.title,
            weekday: template.weekday,
            startTimeMinutes: template.startTimeMinutes,
            endTimeMinutes: template.endTimeMinutes,
            capacity: template.capacity
          }
        })
      )
    )

    const assignments = buildLeagueAssignments(league.id, sessions, users)
    if (assignments.length > 0) {
      await prisma.slotAssignment.createMany({ data: assignments })
      await prisma.leagueMembership.createMany({
        data: assignments.map((assignment) => ({
          leagueId: assignment.leagueId,
          userId: assignment.userId,
          status: 'ACTIVE' as const
        })),
        skipDuplicates: true
      })
    }

    const occurrences = sessions.flatMap((session) =>
      buildOccurrenceDates(
        leagueConfig.startDateParts,
        leagueConfig.durationWeeks,
        session.weekday,
        session.startTimeMinutes,
        session.endTimeMinutes
      ).map((occurrence) => ({
        sessionId: session.id,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt
      }))
    )

    if (occurrences.length > 0) {
      await prisma.sessionOccurrence.createMany({ data: occurrences })
    }

    const createdOccurrences = await prisma.sessionOccurrence.findMany({
      where: { sessionId: { in: sessions.map((session) => session.id) } },
      select: { id: true, sessionId: true, startsAt: true }
    })

    const { registrationCount, subSignupCount } = await backfillPastOccurrenceActivity(
      createdOccurrences,
      assignments,
      allUserIds
    )

    totalSessionCount += sessions.length
    totalOccurrenceCount += occurrences.length
    totalAssignmentCount += assignments.length
    totalRegistrationCount += registrationCount
    totalSubSignupCount += subSignupCount

    logger.info(
      {
        leagueId: league.id,
        leagueName: league.name,
        leagueStatus: league.status,
        leagueDurationWeeks: leagueConfig.durationWeeks,
        sessions: sessions.length,
        occurrences: occurrences.length,
        assignments: assignments.length,
        registrations: registrationCount,
        subSignups: subSignupCount,
        rules: leagueRules.length
      },
      'Seeded demo league data'
    )
  }

  return {
    leagueCount: leagueSeedConfigs.length,
    totalSessionCount,
    totalOccurrenceCount,
    totalAssignmentCount,
    totalRegistrationCount,
    totalSubSignupCount
  }
}

const seedLeagues = async () => {
  const organizations = await ensureOrganizations()
  await clearDemoOrganizationLeagues(organizations.demoOrganization.id)

  const seededUsers = await findSeededUsers()
  await clearSeededUserData(seededUsers.map((user) => user.id))

  const persistedProtectedUsers = await ensureProtectedUsers()
  await ensureProtectedOwners(
    [organizations.hbkOrganization.id, organizations.demoOrganization.id],
    persistedProtectedUsers
  )

  const sessionTemplates = buildSessionTemplates()
  ensureSeedCounts(sessionTemplates)
  const seedGeneratedUserCount = getSeedGeneratedUserCount(sessionTemplates)
  const userData = buildUserData(seedGeneratedUserCount)
  await prisma.user.createMany({ data: userData })

  const createdSeedUsers = await prisma.user.findMany({
    where: {
      phoneNumber: {
        in: userData.map((user) => user.phoneNumber)
      }
    },
    orderBy: { phoneNumber: 'asc' }
  })

  if (createdSeedUsers.length !== userData.length) {
    throw new Error('Seeded user creation count mismatch')
  }

  const usersForAssignments = [...persistedProtectedUsers, ...createdSeedUsers]
  const demoSeedResult = await seedDemoOrganizationLeagues(organizations.demoOrganization.id, usersForAssignments)

  logger.info(
    {
      organizations: [organizations.hbkOrganization.slug, organizations.demoOrganization.slug],
      protectedUsers: persistedProtectedUsers.length,
      seededUsers: createdSeedUsers.length,
      leagues: demoSeedResult.leagueCount,
      sessions: demoSeedResult.totalSessionCount,
      occurrences: demoSeedResult.totalOccurrenceCount,
      assignments: demoSeedResult.totalAssignmentCount,
      registrations: demoSeedResult.totalRegistrationCount,
      subSignups: demoSeedResult.totalSubSignupCount
    },
    'Seed data created'
  )
}

const runSeed = async () => {
  try {
    await seedLeagues()
  } catch (error) {
    logger.error({ error }, 'Seed failed')
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

await runSeed()
