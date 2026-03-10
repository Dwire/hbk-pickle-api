const easternTimeZone = 'America/New_York'
const localeEnUs = 'en-US'
const weekdayFormatStyle = 'short'
const hourCycle24 = 'h23'
const literalPartType = 'literal'
const yearPartType = 'year'
const monthPartType = 'month'
const dayPartType = 'day'
const hourPartType = 'hour'
const minutePartType = 'minute'
const secondPartType = 'second'
const weekdayLabelSun = 'Sun'
const weekdayLabelMon = 'Mon'
const weekdayLabelTue = 'Tue'
const weekdayLabelWed = 'Wed'
const weekdayLabelThu = 'Thu'
const weekdayLabelFri = 'Fri'
const weekdayLabelSat = 'Sat'
const sundayIndex = 0
const mondayIndex = 1
const daysPerWeek = 7
const millisecondsPerMinute = 60_000
const weekStartHour = 0
const weekStartMinute = 0
const weekStartSecond = 0
const weekStartMillisecond = 0
const weekEndHour = 23
const weekEndMinute = 59
const weekEndSecond = 59
const weekEndMillisecond = 999
const registrationCloseHourDefault = 21
const minutesPerHour = 60

/** IANA timezone used for Eastern business rules. */
export { easternTimeZone }

export type DateParts = {
  year: number
  month: number
  day: number
}

export type DateTimeParts = DateParts & {
  hour: number
  minute: number
  second: number
}

export type LocalDateTime = DateTimeParts & {
  millisecond: number
}

const easternDateTimeFormat = new Intl.DateTimeFormat(localeEnUs, {
  timeZone: easternTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: hourCycle24
})

const easternWeekdayFormat = new Intl.DateTimeFormat(localeEnUs, {
  timeZone: easternTimeZone,
  weekday: weekdayFormatStyle
})

const weekdayIndexByLabel: Record<string, number> = {
  [weekdayLabelSun]: sundayIndex,
  [weekdayLabelMon]: mondayIndex,
  [weekdayLabelTue]: 2,
  [weekdayLabelWed]: 3,
  [weekdayLabelThu]: 4,
  [weekdayLabelFri]: 5,
  [weekdayLabelSat]: 6
}

/** Returns Eastern-local date + time parts for a UTC instant. */
export const getEasternDateTimeParts = (date: Date): DateTimeParts => {
  const parts = easternDateTimeFormat.formatToParts(date)
  const lookup = new Map<string, string>()

  for (const part of parts) {
    if (part.type === literalPartType) {
      continue
    }

    lookup.set(part.type, part.value)
  }

  const yearValue = Number(lookup.get(yearPartType))
  const monthValue = Number(lookup.get(monthPartType))
  const dayValue = Number(lookup.get(dayPartType))
  const hourValue = Number(lookup.get(hourPartType))
  const minuteValue = Number(lookup.get(minutePartType))
  const secondValue = Number(lookup.get(secondPartType))

  return {
    year: yearValue,
    month: monthValue,
    day: dayValue,
    hour: hourValue,
    minute: minuteValue,
    second: secondValue
  }
}

/** Returns Eastern-local date parts for a UTC instant. */
export const getEasternDateParts = (date: Date): DateParts => {
  const parts = getEasternDateTimeParts(date)
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day
  }
}

/** Shifts a date by days using calendar math (no timezone assumptions). */
export const shiftDateByDays = (dateParts: DateParts, offsetDays: number): DateParts => {
  const shifted = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + offsetDays))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  }
}

/** Returns Eastern weekday index (Sun=0..Sat=6) for a UTC instant. */
export const getEasternWeekdayIndex = (date: Date): number => {
  const label = easternWeekdayFormat.format(date)
  return weekdayIndexByLabel[label] ?? sundayIndex
}

const getEasternOffsetMinutes = (date: Date): number => {
  const parts = easternDateTimeFormat.formatToParts(date)
  const lookup = new Map<string, string>()

  for (const part of parts) {
    if (part.type === literalPartType) {
      continue
    }

    lookup.set(part.type, part.value)
  }

  const yearValue = Number(lookup.get(yearPartType))
  const monthValue = Number(lookup.get(monthPartType))
  const dayValue = Number(lookup.get(dayPartType))
  const hourValue = Number(lookup.get(hourPartType))
  const minuteValue = Number(lookup.get(minutePartType))
  const secondValue = Number(lookup.get(secondPartType))

  const utcTimestamp = Date.UTC(yearValue, monthValue - 1, dayValue, hourValue, minuteValue, secondValue)

  return (utcTimestamp - date.getTime()) / millisecondsPerMinute
}

/** Converts an Eastern-local wall-clock time to a UTC instant. */
export const easternZonedTimeToUtc = (local: LocalDateTime): Date => {
  const utcGuess = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond))
  const offsetMinutes = getEasternOffsetMinutes(utcGuess)
  return new Date(utcGuess.getTime() - offsetMinutes * millisecondsPerMinute)
}

const toEasternWallClockTimestamp = (parts: LocalDateTime): number =>
  Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond)

/** Returns an Eastern wall-clock timestamp for a UTC instant. */
export const getEasternWallClockTimestamp = (date: Date): number => {
  const easternParts = getEasternDateTimeParts(date)
  return toEasternWallClockTimestamp({ ...easternParts, millisecond: date.getUTCMilliseconds() })
}

const resolveEasternWeekDateParts = (date: Date): { start: DateParts; end: DateParts } => {
  const nowParts = getEasternDateTimeParts(date)
  const nowDateParts: DateParts = { year: nowParts.year, month: nowParts.month, day: nowParts.day }
  const weekdayIndex = getEasternWeekdayIndex(date)
  const daysSinceWeekStart = (weekdayIndex - mondayIndex + daysPerWeek) % daysPerWeek
  const startDateParts = shiftDateByDays(nowDateParts, -daysSinceWeekStart)
  const endDateParts = shiftDateByDays(startDateParts, daysPerWeek - 1)

  return { start: startDateParts, end: endDateParts }
}

/** Returns the UTC instants bounding the Eastern-local day for the provided UTC instant. */
export const getEasternDayRangeUtc = (date: Date): { start: Date; end: Date } => {
  const dateParts = getEasternDateParts(date)
  const start = easternZonedTimeToUtc({
    ...dateParts,
    hour: weekStartHour,
    minute: weekStartMinute,
    second: weekStartSecond,
    millisecond: weekStartMillisecond
  })
  const end = easternZonedTimeToUtc({
    ...dateParts,
    hour: weekEndHour,
    minute: weekEndMinute,
    second: weekEndSecond,
    millisecond: weekEndMillisecond
  })

  return { start, end }
}

/** Returns UTC instant for a registration close warning (Eastern day-before at 21:00 minus minutes). */
export const getEasternRegistrationCloseWarningAt = (startsAt: Date, warningMinutes: number): Date => {
  const occurrenceParts = getEasternDateTimeParts(startsAt)
  const dayBeforeParts = shiftDateByDays(
    { year: occurrenceParts.year, month: occurrenceParts.month, day: occurrenceParts.day },
    -1
  )

  return easternZonedTimeToUtc({
    ...dayBeforeParts,
    hour: registrationCloseHourDefault,
    minute: -warningMinutes,
    second: 0,
    millisecond: 0
  })
}

/** Converts Eastern-local minutes since midnight into a UTC instant for the given Eastern day. */
export const easternDayMinutesToUtc = (date: DateParts, minutesFromMidnight: number): Date => {
  const hour = Math.floor(minutesFromMidnight / minutesPerHour)
  const minute = minutesFromMidnight % minutesPerHour
  return easternZonedTimeToUtc({
    ...date,
    hour,
    minute,
    second: 0,
    millisecond: 0
  })
}

/** Returns UTC instants for the Eastern-local Monday 00:00 through Sunday 23:59:59.999 of the week. */
export const getEasternWeekRangeUtc = (date: Date): { start: Date; end: Date } => {
  const { start: startDateParts, end: endDateParts } = resolveEasternWeekDateParts(date)
  const start = easternZonedTimeToUtc({
    ...startDateParts,
    hour: weekStartHour,
    minute: weekStartMinute,
    second: weekStartSecond,
    millisecond: weekStartMillisecond
  })
  const end = easternZonedTimeToUtc({
    ...endDateParts,
    hour: weekEndHour,
    minute: weekEndMinute,
    second: weekEndSecond,
    millisecond: weekEndMillisecond
  })

  return { start, end }
}
