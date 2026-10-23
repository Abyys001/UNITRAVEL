import type { WorkflowConfig } from "@unitravel/contracts"

type Hours = WorkflowConfig["businessHours"]

function localParts(tz: string, at: Date): { day: number; minutes: number } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at)
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(f.find((p) => p.type === "weekday")!.value)
  return { day: wd, minutes: Number(f.find((p) => p.type === "hour")!.value) * 60 + Number(f.find((p) => p.type === "minute")!.value) }
}
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))

/** Open if any team is within its hours — London and Tehran teams, so Iranian mornings are not "overnight" (ch. 13.5). */
export function isBusinessTime(hours: Hours, at = new Date()): boolean {
  return hours.some((h) => {
    const p = localParts(h.timezone, at)
    return h.days.includes(p.day) && p.minutes >= toMin(h.start) && p.minutes < toMin(h.end)
  })
}

/** Adds N business minutes to a start time, stepping minute-blocks through closed periods (bounded to 14 days). */
export function addBusinessMinutes(hours: Hours, start: Date, minutes: number): Date {
  let t = start.getTime()
  let left = minutes
  const step = 5 * 60_000
  const limit = t + 14 * 86400_000
  while (left > 0 && t < limit) {
    if (isBusinessTime(hours, new Date(t))) left -= 5
    t += step
  }
  return new Date(t)
}
