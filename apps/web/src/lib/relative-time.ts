const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400], ["hour", 3_600], ["minute", 60]]

/** "6 hours ago" in the visitor's language; under a minute reads as "this minute". */
export function ago(iso: string, locale: string, now = Date.now()) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  for (const [unit, size] of STEPS) if (seconds >= size) return rtf.format(-Math.floor(seconds / size), unit)
  return rtf.format(0, "minute")
}
