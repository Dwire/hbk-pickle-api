import type { RegistrationStatus, SubSignupStatus, Weekday } from '../generated/prisma/client.js'
import { logger } from '../shared/logger.js'
import { prisma } from '../shared/prisma.js'
import {
  easternDayMinutesToUtc,
  easternZonedTimeToUtc,
  getEasternWeekRangeUtc,
  shiftDateByDays,
  type DateParts
} from '../shared/time.js'

const seedLeagueNamePrefix = 'Seed League'
const seedLeagueTimeZone = 'America/New_York'
const seedUserDisplayNamePrefix = 'Seed Player'
const seedPhonePrefix = '+155500'
const protectedUserId = '714415e3-5239-4db0-9800-add7cc45c4c9'
const protectedUserPhoneNumber = '+1555990000'
const protectedUserDisplayName = 'Seed Protected Player'

const seedLeagueCount = 3
const pastLeagueCount = 2
const leagueDurationWeeks = 3
const playersPerSession = 5
const protectedUserCount = 1
const sessionsPerDay = 3

const minutesPerHour = 60
const sessionDurationMinutes = 90
const firstSessionStartHour = 18
const secondSessionStartHour = 20
const thirdSessionStartHour = 22
const sessionStartMinute = 0
const phoneNumberStart = 1
const phoneNumberWidth = 4
const daysInWeek = 7
const randomRegistrationMin = 1
const randomRegistrationMax = 5
const randomSubSignupMin = 3
const randomSubSignupMax = 10

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
  isActive: boolean
  startDateParts: DateParts
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
  sessionTemplates.length * playersPerSession - protectedUserCount

const ensureSeedCounts = (sessionTemplates: SessionTemplateConfig[]) => {
  const seedGeneratedUserCount = getSeedGeneratedUserCount(sessionTemplates)
  if (seedGeneratedUserCount <= 0) {
    throw new Error('Seed user count must be greater than zero after reserving protected user')
  }

  if (seedLeagueCount !== pastLeagueCount + 1) {
    throw new Error('Seed league configuration must include exactly one current league')
  }

  const expectedTemplateCount = seedWeekdays.length * sessionsPerDay
  if (sessionTemplates.length !== expectedTemplateCount) {
    throw new Error(
      `Seed must define exactly ${String(expectedTemplateCount)} session templates (${String(sessionsPerDay)} per day)`
    )
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
  Array.from({ length: seedLeagueCount }, (_, leagueIndex) => {
    const weekOffsetFromCurrent = (leagueIndex - pastLeagueCount) * leagueDurationWeeks
    const startDateParts = shiftDateByDays(currentWeekStartDateParts, weekOffsetFromCurrent * daysInWeek)
    const isCurrentLeague = leagueIndex === seedLeagueCount - 1

    return {
      name: isCurrentLeague ? `${seedLeagueNamePrefix} Current` : `${seedLeagueNamePrefix} Past ${String(leagueIndex + 1)}`,
      isActive: isCurrentLeague,
      startDateParts
    }
  })

const buildUserData = (seedGeneratedUserCount: number) =>
  Array.from({ length: seedGeneratedUserCount }, (_, index) => {
    const suffix = String(phoneNumberStart + index).padStart(phoneNumberWidth, '0')
    return {
      phoneNumber: `${seedPhonePrefix}${suffix}`,
      displayName: `${seedUserDisplayNamePrefix} ${String(index + 1).padStart(2, '0')}`,
      role: 'PLAYER' as const
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
  weekday: Weekday,
  startMinutes: number,
  endMinutes: number
) =>
  Array.from({ length: leagueDurationWeeks }, (_, weekIndex) => {
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

const clearSeedData = async () => {
  const notificationResult = await prisma.notification.deleteMany()
  logger.info({ count: notificationResult.count }, 'Cleared notifications')

  const subSignupResult = await prisma.subSignup.deleteMany()
  logger.info({ count: subSignupResult.count }, 'Cleared sub signups')

  const registrationResult = await prisma.sessionRegistration.deleteMany()
  logger.info({ count: registrationResult.count }, 'Cleared session registrations')

  const assignmentResult = await prisma.slotAssignment.deleteMany()
  logger.info({ count: assignmentResult.count }, 'Cleared slot assignments')

  const occurrenceResult = await prisma.sessionOccurrence.deleteMany()
  logger.info({ count: occurrenceResult.count }, 'Cleared session occurrences')

  const sessionResult = await prisma.session.deleteMany()
  logger.info({ count: sessionResult.count }, 'Cleared sessions')

  const ruleResult = await prisma.leagueRule.deleteMany()
  logger.info({ count: ruleResult.count }, 'Cleared league rules')

  const leagueResult = await prisma.league.deleteMany()
  logger.info({ count: leagueResult.count }, 'Cleared leagues')

  const deviceResult = await prisma.userDevice.deleteMany()
  logger.info({ count: deviceResult.count }, 'Cleared user devices')

  const userResult = await prisma.user.deleteMany({ where: { id: { not: protectedUserId } } })
  logger.info({ count: userResult.count }, 'Cleared users (excluding protected user)')
}

const ensureProtectedUser = async () => {
  const existingUser = await prisma.user.findUnique({ where: { id: protectedUserId } })
  if (existingUser) {
    logger.info({ userId: protectedUserId }, 'Protected user already exists')
    return existingUser
  }

  const createdUser = await prisma.user.create({
    data: {
      id: protectedUserId,
      phoneNumber: protectedUserPhoneNumber,
      displayName: protectedUserDisplayName,
      role: 'PLAYER'
    }
  })
  logger.info({ userId: createdUser.id }, 'Created protected user')
  return createdUser
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

const seedLeagues = async () => {
  const sessionTemplates = buildSessionTemplates()
  ensureSeedCounts(sessionTemplates)
  await clearSeedData()

  const currentWeekStartDateParts = getCurrentWeekStartDateParts()
  const leagueSeedConfigs = buildLeagueSeedConfigs(currentWeekStartDateParts)

  const protectedUser = await ensureProtectedUser()
  const userData = buildUserData(getSeedGeneratedUserCount(sessionTemplates))
  await prisma.user.createMany({ data: userData })
  const seedUsers = await prisma.user.findMany({
    where: { phoneNumber: { startsWith: seedPhonePrefix } },
    orderBy: { phoneNumber: 'asc' }
  })
  const users = [protectedUser, ...seedUsers]
  const allUserIds = users.map((user) => user.id)

  let totalSessionCount = 0
  let totalOccurrenceCount = 0
  let totalAssignmentCount = 0
  let totalRegistrationCount = 0
  let totalSubSignupCount = 0

  for (const leagueConfig of leagueSeedConfigs) {
    const leagueEndDateParts = shiftDateByDays(leagueConfig.startDateParts, daysInWeek * leagueDurationWeeks)

    const league = await prisma.league.create({
      data: {
        name: leagueConfig.name,
        timeZone: seedLeagueTimeZone,
        startDate: toEasternMidnightUtc(leagueConfig.startDateParts),
        endDate: toEasternMidnightUtc(leagueEndDateParts),
        isActive: leagueConfig.isActive
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
    }

    const occurrences = sessions.flatMap((session) =>
      buildOccurrenceDates(
        leagueConfig.startDateParts,
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
        isActive: league.isActive,
        sessions: sessions.length,
        occurrences: occurrences.length,
        assignments: assignments.length,
        registrations: registrationCount,
        subSignups: subSignupCount,
        rules: leagueRules.length
      },
      'Seeded league data'
    )
  }

  logger.info(
    {
      leagues: leagueSeedConfigs.length,
      users: users.length,
      sessions: totalSessionCount,
      occurrences: totalOccurrenceCount,
      assignments: totalAssignmentCount,
      registrations: totalRegistrationCount,
      subSignups: totalSubSignupCount
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
