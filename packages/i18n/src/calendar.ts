export type CalendarKind = "GREGORIAN" | "JALALI"

const DAY_MS = 86_400_000
const utc = (iso: string) => Date.parse(`${iso}T12:00:00Z`)

/** BCP-47 locale for a UI language and calendar. Formatting and month maths both go through Intl so the two cannot disagree. */
export const calendarLocale = (locale: "en" | "fa", cal: CalendarKind) => `${locale === "fa" ? "fa-IR" : "en-GB"}-u-ca-${cal === "JALALI" ? "persian" : "gregory"}`

export const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10)
export const nightsBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS)

const dayFormat = { GREGORIAN: new Intl.DateTimeFormat("en-u-ca-gregory-nu-latn", { timeZone: "UTC", day: "numeric" }), JALALI: new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { timeZone: "UTC", day: "numeric" }) }
const dayOfMonth = (iso: string, cal: CalendarKind) => Number(dayFormat[cal].format(utc(iso)))

export const firstOfMonth = (iso: string, cal: CalendarKind) => addDays(iso, 1 - dayOfMonth(iso, cal))

/** First day of the month `n` months away, in the given calendar. */
export function shiftMonth(iso: string, n: number, cal: CalendarKind): string {
  let first = firstOfMonth(iso, cal)
  for (let i = 0; i < n; i++) first = addDays(first, 32 - dayOfMonth(addDays(first, 31), cal))
  for (let i = 0; i > n; i--) first = firstOfMonth(addDays(first, -1), cal)
  return first
}

/** Every date in the month that holds `iso`, first to last. */
export function monthDays(iso: string, cal: CalendarKind): string[] {
  const first = firstOfMonth(iso, cal)
  const next = shiftMonth(first, 1, cal)
  return Array.from({ length: nightsBetween(first, next) }, (_, i) => addDays(first, i))
}

/** Iranian weeks start on Saturday, UK weeks on Monday. Returned as JS weekday numbers (0 = Sunday). */
export const weekStart = (cal: CalendarKind) => (cal === "JALALI" ? 6 : 1)

/** Month as table rows of seven cells, with null for the blanks before the first day and after the last. */
export function monthWeeks(iso: string, cal: CalendarKind): (string | null)[][] {
  const days = monthDays(iso, cal)
  const blanks = (new Date(utc(days[0]!)).getUTCDay() - weekStart(cal) + 7) % 7
  const cells: (string | null)[] = [...Array<null>(blanks).fill(null), ...days]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

/** The seven dates of one week, for weekday column headers. 2026-01-03 is a Saturday. */
export const weekdaySample = (cal: CalendarKind) => Array.from({ length: 7 }, (_, i) => addDays("2026-01-03", i + (weekStart(cal) === 6 ? 0 : 2)))
