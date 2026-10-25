import { toPersianDigits } from "@unitravel/i18n"

import type { Locale } from "@unitravel/i18n"

/**
 * Staff-written notes arrive in English ("3-5 working days"). In Persian a bare hyphenated range inside RTL text
 * reverses ("5-3"), so numeric ranges become "۳ تا ۵" and the common unit is translated. Other text is left as written.
 */
export function localiseRanges(text: string, locale: Locale): string {
  if (locale !== "fa") return text
  return text
    .replace(/(\d+)\s*[-–]\s*(\d+)/g, (_, a: string, b: string) => `${toPersianDigits(a)} تا ${toPersianDigits(b)}`)
    .replace(/\b(working|business)\s+days?\b/gi, "روز کاری")
    .replace(/\b(\d+)\b/g, (n) => toPersianDigits(n))
}
