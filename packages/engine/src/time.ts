export function minutesBetween(fromUtc: string, toUtc: string): number {
  return Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 60000)
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Treat a local wall-clock string as if it were UTC, so two local times at the same airport can be compared. */
function localMs(local: string): number {
  return Date.parse(`${local}:00Z`)
}

/** Whether the interval between arrival and departure (hub local time) overlaps the local night window. */
export function crossesLocalNight(arrivalLocal: string, departureLocal: string, window: [number, number]): boolean {
  const start = localMs(arrivalLocal)
  const end = localMs(departureLocal)
  if (end <= start) return false
  const [from, to] = window
  const day = new Date(start)
  day.setUTCHours(0, 0, 0, 0)
  for (let t = day.getTime() - 86400000; t <= end; t += 86400000) {
    const nightStart = t + from * 3600000
    const nightEnd = t + to * 3600000
    if (start < nightEnd && end > nightStart) return true
  }
  return false
}

export function localHour(local: string): number {
  return Number(local.slice(11, 13))
}

/** Calendar-day difference between two local date-times (for "+1" day markers). */
export function dayOffset(fromLocal: string, toLocal: string): number {
  return Math.round((Date.parse(`${toLocal.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromLocal.slice(0, 10)}T00:00:00Z`)) / 86400000)
}

/** FNV-1a 32-bit ×2 → stable short id without any I/O. */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0
  }
  return h1.toString(36).padStart(7, "0") + h2.toString(36).padStart(7, "0")
}
