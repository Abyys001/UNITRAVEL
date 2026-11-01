# ADR-0024: Mobile dates show both the Solar Hijri and Gregorian calendars

- Status: accepted (owner request, 1 Nov 2026: display dates using both the Gregorian and Solar Hijri calendars to make them easier to read)
- Scope: Flutter mobile (`apps/mobile`). Customer web, console, PDFs and email are unchanged.

## Context
The booklet shows one calendar chosen by user preference (DOCUMENTED: `docs/booklet.txt` lines 2201, 3503, 6700). Customers plan around both calendars: Persian-speaking travellers think in Solar Hijri, while tickets and carriers use Gregorian dates.

## Decision
Every date in the mobile app shows both calendars, for example `۱۹ آذر ۱۴۰۵ (۱۰ دسامبر ۲۰۲۶)` or `Dec 10, 2026 (19 Azar 1405)`.
- The existing `calendar` preference now decides which calendar comes first. The Account screen labels it "Primary calendar".
- Signed-out users get Solar Hijri first in Persian and Gregorian first in English.
- All formatting stays in `apps/mobile/lib/core/format.dart`. Storage and the API are unchanged (ISO-8601 UTC).

## Consequences
- Dates are longer, so tight rows must wrap rather than clip.
- Mobile and web can show the same date differently until the owner decides whether web should follow.
- Mobile goldens containing dates are regenerated.
