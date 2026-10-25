import { createHash } from "node:crypto"

/** Dates render in the recipient's time zone, with the zone named, and calendar (Jalali for Persian users who chose it) — ch. 17.4. */
export function formatLocal(iso: string | Date, opts: { locale: "en" | "fa"; tz: string; calendar: "GREGORIAN" | "JALALI" }): string {
  const d = typeof iso === "string" ? new Date(iso) : iso
  const loc = opts.locale === "fa" ? (opts.calendar === "JALALI" ? "fa-IR-u-ca-persian" : "fa-IR-u-ca-gregory") : opts.calendar === "JALALI" ? "en-GB-u-ca-persian" : "en-GB"
  return new Intl.DateTimeFormat(loc, { timeZone: opts.tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(d)
}

/** Fills {var} placeholders; unknown variables stay visible so template mistakes are noticed in review. */
export function renderTemplate(body: string, vars: Record<string, string | number | undefined>): string {
  return body.replace(/\{([a-z_]+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])))
}

export function templateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!))]
}

/** Local hour/minute in a zone, for quiet hours. */
export function localTime(tz: string, at = new Date()): { h: number; m: number } {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).split(":").map(Number)
  return { h: h!, m: m! }
}

/** Milliseconds until the end of quiet hours (e.g. 22:00–08:00) in the recipient's zone; 0 when outside them. */
export function quietHoursDelay(tz: string, quiet: { start: string; end: string }, at = new Date()): number {
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
  const { h, m } = localTime(tz, at)
  const now = h * 60 + m
  const start = toMin(quiet.start)
  const end = toMin(quiet.end)
  const inQuiet = start > end ? now >= start || now < end : now >= start && now < end
  if (!inQuiet) return 0
  const minutes = now < end ? end - now : 24 * 60 - now + end
  return minutes * 60_000
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** notifications.event_id is a uuid column; timer events use composite keys (`fr.deadline_2:<id>:<version>`), so map them to a stable uuid. The full key stays in dedupe_key. */
export function eventUuid(eventId: string): string {
  if (UUID_RE.test(eventId)) return eventId
  const h = createHash("sha256").update(eventId).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Templates use both `{expires_at_local}` and `{deadline_local}`, so an `<x>_at` variable yields `<x>_at_local` and `<x>_local`. */
export function localDateVars(key: string, iso: string, opts: Parameters<typeof formatLocal>[1]): Record<string, string> {
  const local = formatLocal(iso, opts)
  return { [`${key}_local`]: local, [`${key.slice(0, -3)}_local`]: local }
}
