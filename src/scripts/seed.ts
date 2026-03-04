import type { Weekday } from '../generated/prisma/client.js'
import { logger } from '../shared/logger.js'
import { prisma } from '../shared/prisma.js'

const seedLeagueName = 'Seed League'
const seedLeagueTimeZone = 'America/New_York'
const seedUserDisplayNamePrefix = 'Seed Player'
const seedPhonePrefix = '+155500'
const protectedUserId = '714415e3-5239-4db0-9800-add7cc45c4c9'
const protectedUserPhoneNumber = '+1555990000'
const protectedUserDisplayName = 'Seed Protected Player'

const seedWeeks = 2
const sessionDaysPerWeek = 3
const sessionsPerDay = 2
const playersPerSession = 5
const protectedUserCount = 1

const minutesPerHour = 60
const sessionDurationMinutes = 90
const firstSessionStartHour = 18
const secondSessionStartHour = 20
const sessionStartMinute = 0
const phoneNumberStart = 1
const phoneNumberWidth = 4
const daysInWeek = 7

const seedWeekdays: Weekday[] = ['MONDAY', 'WEDNESDAY', 'FRIDAY']

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

const weekdayIndexMap: Record<Weekday, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 0
}

const totalSessionSlots = sessionDaysPerWeek * sessionsPerDay * playersPerSession
const seedGeneratedUserCount = totalSessionSlots - protectedUserCount

const ensureSeedCounts = () => {
  if (seedGeneratedUserCount <= 0) {
    throw new Error('Seed user count must be greater than zero after reserving protected user')
  }
}

const addDays = (date: Date, daysToAdd: number) => {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + daysToAdd)
  return next
}

const getCurrentWeekStartDate = () => {
  const today = new Date()
  const baseDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const currentWeekday = baseDate.getUTCDay()
  const mondayIndex = weekdayIndexMap.MONDAY
  const daysSinceMonday = (currentWeekday - mondayIndex + daysInWeek) % daysInWeek
  return addDays(baseDate, -daysSinceMonday)
}

const buildUserData = () =>
  Array.from({ length: seedGeneratedUserCount }, (_, index) => {
    const suffix = String(phoneNumberStart + index).padStart(phoneNumberWidth, '0')
    return {
      phoneNumber: `${seedPhonePrefix}${suffix}`,
      displayName: `${seedUserDisplayNamePrefix} ${String(index + 1).padStart(2, '0')}`,
      role: 'PLAYER' as const
    }
  })

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

const buildOccurrenceDates = (baseWeekStart: Date, weekday: Weekday, startMinutes: number, endMinutes: number) =>
  Array.from({ length: seedWeeks }, (_, weekIndex) => {
    const dayOffset = weekdayIndexMap[weekday] - weekdayIndexMap.MONDAY
    const dayStart = addDays(baseWeekStart, weekIndex * daysInWeek + dayOffset)
    const startsAt = new Date(dayStart)
    startsAt.setUTCMinutes(startMinutes)
    const endsAt = new Date(dayStart)
    endsAt.setUTCMinutes(endMinutes)
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
  ensureSeedCounts()
  await clearSeedData()

  const baseWeekStart = getCurrentWeekStartDate()
  const leagueEndDate = addDays(baseWeekStart, daysInWeek * seedWeeks)

  const league = await prisma.league.create({
    data: {
      name: seedLeagueName,
      timeZone: seedLeagueTimeZone,
      startDate: baseWeekStart,
      endDate: leagueEndDate,
      isActive: true
    }
  })

  const protectedUser = await ensureProtectedUser()
  const userData = buildUserData()
  await prisma.user.createMany({ data: userData })
  const seedUsers = await prisma.user.findMany({
    where: { phoneNumber: { startsWith: seedPhonePrefix } },
    orderBy: { phoneNumber: 'asc' }
  })
  const users = [protectedUser, ...seedUsers]

  const sessionTemplates = buildSessionTemplates()
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

  if (occurrences.length > 0) {
    await prisma.sessionOccurrence.createMany({ data: occurrences })
  }

  logger.info(
    {
      leagueId: league.id,
      users: users.length,
      sessions: sessions.length,
      occurrences: occurrences.length,
      assignments: assignments.length
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
