import type { Weekday } from '../generated/prisma/client.js'
import { logger } from '../shared/logger.js'
import { prisma } from '../shared/prisma.js'
import {
  easternDayMinutesToUtc,
  easternZonedTimeToUtc,
  getEasternDateParts,
  getEasternWeekRangeUtc,
  shiftDateByDays
} from '../shared/time.js'

const seedLeagueName = 'Seed League'
const seedLeagueTimeZone = 'America/New_York'
const seedUserDisplayNamePrefix = 'Seed Player'
const seedPhonePrefix = '+155500'
const protectedUserId = '714415e3-5239-4db0-9800-add7cc45c4c9'
const protectedUserPhoneNumber = '+1555990000'
const protectedUserDisplayName = 'Seed Protected Player'

const seedWeeks = 2
const playersPerSession = 5
const protectedUserCount = 1
const thursdaySessionTemplateCount = 3

const minutesPerHour = 60
const sessionDurationMinutes = 90
const firstSessionStartHour = 18
const secondSessionStartHour = 20
const thirdThursdaySessionStartHour = 22
const sessionStartMinute = 0
const phoneNumberStart = 1
const phoneNumberWidth = 4
const daysInWeek = 7
const dateSegmentWidth = 2
const zeroPadCharacter = '0'
const monthDaySeparator = '/'
const thursdayWeekday: Weekday = 'THURSDAY'

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

const sessionTimeConfigs: SessionTimeConfig[] = [
  {
    label: 'Early',
    startMinutes: firstSessionStartHour * minutesPerHour + sessionStartMinute,
    endMinutes: firstSessionStartHour * minutesPerHour + sessionStartMinute + sessionDurationMinutes
  },
  {
    label: 'Late',
    startMinutes: secondSessionStartHour * minutesPerHour + sessionStartMinute,
    endMinutes: secondSessionStartHour * minutesPerHour + sessionStartMinute + sessionDurationMinutes
  }
]

const thursdaySessionTimeConfigs: SessionTimeConfig[] = [
  ...sessionTimeConfigs,
  {
    label: 'Night',
    startMinutes: thirdThursdaySessionStartHour * minutesPerHour + sessionStartMinute,
    endMinutes: thirdThursdaySessionStartHour * minutesPerHour + sessionStartMinute + sessionDurationMinutes
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
  seedWeekdays.flatMap((weekday) => {
    const weekdaySessionTimes = weekday === thursdayWeekday ? thursdaySessionTimeConfigs : sessionTimeConfigs
    return weekdaySessionTimes.map((timeConfig) => ({
      title: `${weekday} ${timeConfig.label}`,
      weekday,
      startTimeMinutes: timeConfig.startMinutes,
      endTimeMinutes: timeConfig.endMinutes,
      capacity: playersPerSession
    }))
  })

const getSeedGeneratedUserCount = (sessionTemplates: SessionTemplateConfig[]) =>
  sessionTemplates.length * playersPerSession - protectedUserCount

const ensureSeedCounts = (sessionTemplates: SessionTemplateConfig[]) => {
  const seedGeneratedUserCount = getSeedGeneratedUserCount(sessionTemplates)
  if (seedGeneratedUserCount <= 0) {
    throw new Error('Seed user count must be greater than zero after reserving protected user')
  }

  const thursdayTemplateCount = sessionTemplates.filter((template) => template.weekday === thursdayWeekday).length
  if (thursdayTemplateCount !== thursdaySessionTemplateCount) {
    throw new Error(`Seed must define exactly ${String(thursdaySessionTemplateCount)} Thursday sessions`)
  }
}

const getCurrentWeekStartDate = () => {
  const { start } = getEasternWeekRangeUtc(new Date())
  return start
}

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

const buildOccurrenceDates = (baseWeekStart: Date, weekday: Weekday, startMinutes: number, endMinutes: number) =>
  Array.from({ length: seedWeeks }, (_, weekIndex) => {
    const dayOffset = weekdayIndexMap[weekday] - weekdayIndexMap.MONDAY
    const dayStart = shiftDateByDays(
      { year: baseWeekStart.getUTCFullYear(), month: baseWeekStart.getUTCMonth() + 1, day: baseWeekStart.getUTCDate() },
      weekIndex * daysInWeek + dayOffset
    )
    const startsAt = easternDayMinutesToUtc(dayStart, startMinutes)
    const endsAt = easternDayMinutesToUtc(dayStart, endMinutes)
    return { startsAt, endsAt }
  })

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

const seedLeague = async () => {
  const sessionTemplates = buildSessionTemplates()
  ensureSeedCounts(sessionTemplates)
  await clearSeedData()

  const baseWeekStart = getCurrentWeekStartDate()
  const baseWeekStartParts = {
    year: baseWeekStart.getUTCFullYear(),
    month: baseWeekStart.getUTCMonth() + 1,
    day: baseWeekStart.getUTCDate()
  }
  const leagueEndDateParts = shiftDateByDays(baseWeekStartParts, daysInWeek * seedWeeks)
  const leagueEndDate = easternZonedTimeToUtc({
    ...leagueEndDateParts,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  })

  const league = await prisma.league.create({
    data: {
      name: seedLeagueName,
      timeZone: seedLeagueTimeZone,
      startDate: easternZonedTimeToUtc({
        ...baseWeekStartParts,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0
      }),
      endDate: leagueEndDate,
      isActive: true
    }
  })

  const leagueRules = buildLeagueRules(league.id)
  if (leagueRules.length > 0) {
    const rulesResult = await prisma.leagueRule.createMany({ data: leagueRules })
    logger.info({ count: rulesResult.count }, 'Seeded league rules')
  }

  const protectedUser = await ensureProtectedUser()
  const userData = buildUserData(getSeedGeneratedUserCount(sessionTemplates))
  await prisma.user.createMany({ data: userData })
  const seedUsers = await prisma.user.findMany({
    where: { phoneNumber: { startsWith: seedPhonePrefix } },
    orderBy: { phoneNumber: 'asc' }
  })
  const users = [protectedUser, ...seedUsers]

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

  const assignments = sessions.flatMap((session, sessionIndex) => {
    const startIndex = sessionIndex * playersPerSession
    const assignedUsers = users.slice(startIndex, startIndex + playersPerSession)
    return assignedUsers.map((user) => ({
      leagueId: league.id,
      sessionId: session.id,
      userId: user.id
    }))
  })

  const protectedUserAssigned = assignments.some((assignment) => assignment.userId === protectedUser.id)
  if (!protectedUserAssigned) {
    const fallbackSession = sessions[0]
    const fallbackSessionTitle = fallbackSession?.title
    if (!fallbackSession) {
      throw new Error('No sessions available to assign protected user')
    }

    assignments.push({
      leagueId: league.id,
      sessionId: fallbackSession.id,
      userId: protectedUser.id
    })
    logger.info(
      { userId: protectedUser.id, sessionId: fallbackSession.id, sessionTitle: fallbackSessionTitle },
      'Assigned protected user to fallback session'
    )
  }

  if (assignments.length > 0) {
    await prisma.slotAssignment.createMany({ data: assignments })
  }

  const occurrences = sessions.flatMap((session) =>
    buildOccurrenceDates(baseWeekStart, session.weekday, session.startTimeMinutes, session.endTimeMinutes).map(
      (occurrence) => ({
        sessionId: session.id,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt
      })
    )
  )

  const targetThursdayDateParts = shiftDateByDays(baseWeekStartParts, weekdayIndexMap.THURSDAY - weekdayIndexMap.MONDAY)
  const expectedTargetThursdayOccurrenceCount = sessionTemplates.filter(
    (template) => template.weekday === thursdayWeekday
  ).length
  const sessionsById = new Map(sessions.map((session) => [session.id, session] as const))
  const targetThursdayOccurrenceCount = occurrences.filter((occurrence) => {
    const session = sessionsById.get(occurrence.sessionId)
    if (session?.weekday !== thursdayWeekday) {
      return false
    }

    const occurrenceDateParts = getEasternDateParts(occurrence.startsAt)
    return (
      occurrenceDateParts.year === targetThursdayDateParts.year &&
      occurrenceDateParts.month === targetThursdayDateParts.month &&
      occurrenceDateParts.day === targetThursdayDateParts.day
    )
  }).length

  if (targetThursdayOccurrenceCount !== expectedTargetThursdayOccurrenceCount) {
    throw new Error(
      `Expected ${String(expectedTargetThursdayOccurrenceCount)} Thursday occurrences for ${String(targetThursdayDateParts.month).padStart(dateSegmentWidth, zeroPadCharacter)}${monthDaySeparator}${String(targetThursdayDateParts.day).padStart(dateSegmentWidth, zeroPadCharacter)}, found ${String(targetThursdayOccurrenceCount)}`
    )
  }

  logger.info(
    {
      targetThursdayDate: `${String(targetThursdayDateParts.month).padStart(dateSegmentWidth, zeroPadCharacter)}${monthDaySeparator}${String(targetThursdayDateParts.day).padStart(dateSegmentWidth, zeroPadCharacter)}`,
      expectedCount: expectedTargetThursdayOccurrenceCount,
      occurrenceCount: targetThursdayOccurrenceCount
    },
    'Validated Thursday occurrences for current Eastern week'
  )

  if (occurrences.length > 0) {
    await prisma.sessionOccurrence.createMany({ data: occurrences })
  }

  logger.info(
    {
      leagueId: league.id,
      users: users.length,
      sessions: sessions.length,
      occurrences: occurrences.length,
      assignments: assignments.length,
      rules: leagueRules.length
    },
    'Seed data created'
  )
}

const runSeed = async () => {
  try {
    await seedLeague()
  } catch (error) {
    logger.error({ error }, 'Seed failed')
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

await runSeed()
