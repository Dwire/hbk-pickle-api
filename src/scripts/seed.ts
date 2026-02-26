import type { Weekday } from '../generated/prisma/client.js'
import { logger } from '../shared/logger.js'
import { prisma } from '../shared/prisma.js'

const seedLeagueName = 'Seed League'
const seedLeagueTimeZone = 'America/New_York'
const seedUserDisplayNamePrefix = 'Seed Player'
const seedPhonePrefix = '+155500'

const seedWeeks = 2
const seedUserCount = 30
const sessionDaysPerWeek = 3
const sessionsPerDay = 2
const playersPerSession = 5

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

const ensureSeedCounts = () => {
  const expectedUsers = sessionDaysPerWeek * sessionsPerDay * playersPerSession
  if (seedUserCount !== expectedUsers) {
    throw new Error('Seed user count does not match total session slots')
  }
}

const addDays = (date: Date, daysToAdd: number) => {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + daysToAdd)
  return next
}

const getNextWeekStartDate = (weekday: Weekday) => {
  const today = new Date()
  const baseDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const currentWeekday = baseDate.getUTCDay()
  const targetWeekday = weekdayIndexMap[weekday]
  const daysUntilTarget = (targetWeekday - currentWeekday + daysInWeek) % daysInWeek
  return addDays(baseDate, daysUntilTarget)
}

const buildUserData = () =>
  Array.from({ length: seedUserCount }, (_, index) => {
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
  const existingLeague = await prisma.league.findFirst({
    where: { name: seedLeagueName },
    select: { id: true }
  })

  if (existingLeague) {
    const existingSessions = await prisma.session.findMany({
      where: { leagueId: existingLeague.id },
      select: { id: true }
    })
    const sessionIds = existingSessions.map((session) => session.id)
    const existingOccurrences = sessionIds.length
      ? await prisma.sessionOccurrence.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { id: true }
        })
      : []
    const occurrenceIds = existingOccurrences.map((occurrence) => occurrence.id)

    if (occurrenceIds.length > 0) {
      await prisma.notification.deleteMany({ where: { occurrenceId: { in: occurrenceIds } } })
      await prisma.subSignup.deleteMany({ where: { occurrenceId: { in: occurrenceIds } } })
      await prisma.sessionRegistration.deleteMany({ where: { occurrenceId: { in: occurrenceIds } } })
      await prisma.sessionOccurrence.deleteMany({ where: { id: { in: occurrenceIds } } })
    }

    await prisma.slotAssignment.deleteMany({ where: { leagueId: existingLeague.id } })
    if (sessionIds.length > 0) {
      await prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
    }
    await prisma.leagueRule.deleteMany({ where: { leagueId: existingLeague.id } })
    await prisma.league.delete({ where: { id: existingLeague.id } })
  }

  const seedUsers = await prisma.user.findMany({
    where: { phoneNumber: { startsWith: seedPhonePrefix } },
    select: { id: true }
  })
  const seedUserIds = seedUsers.map((user) => user.id)
  if (seedUserIds.length === 0) {
    return
  }

  await prisma.notification.deleteMany({ where: { userId: { in: seedUserIds } } })
  await prisma.subSignup.deleteMany({ where: { userId: { in: seedUserIds } } })
  await prisma.sessionRegistration.deleteMany({ where: { userId: { in: seedUserIds } } })
  await prisma.slotAssignment.deleteMany({ where: { userId: { in: seedUserIds } } })
  await prisma.userDevice.deleteMany({ where: { userId: { in: seedUserIds } } })
  await prisma.user.deleteMany({ where: { id: { in: seedUserIds } } })
}

const seedLeague = async () => {
  ensureSeedCounts()
  await clearSeedData()

  const baseWeekStart = getNextWeekStartDate('MONDAY')
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

  const userData = buildUserData()
  await prisma.user.createMany({ data: userData })
  const users = await prisma.user.findMany({
    where: { phoneNumber: { startsWith: seedPhonePrefix } },
    orderBy: { phoneNumber: 'asc' }
  })

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
