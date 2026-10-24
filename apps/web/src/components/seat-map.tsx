"use client"

import type { CustomerSeatMap } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

/**
 * Seat map rendering rules (ch. 7.4): rows and sections exactly as supplied, a designator on every seat, text and
 * patterns rather than colour alone, the cabin never mirrored in Persian (nose at the top), 32 px minimum targets.
 */
export function SeatMapView({ map, chosen, onChoose }: { map: CustomerSeatMap; chosen?: string; onChoose: (d: string) => void }) {
  const { t, money, date } = useI18n()
  const cabin = map.cabins[0]
  if (!cabin) return null
  return (
    <div dir="ltr" className="card-brand p-4">
      <p className="mb-2 text-center text-xs uppercase tracking-widest text-steel">▲ front</p>
      <div className="mx-auto max-h-[520px] w-fit overflow-auto px-2">
        {cabin.rows.map((row, ri) => (
          <div key={ri} className="flex items-center justify-center gap-5 py-0.5">
            {row.sections.map((sec, si) => (
              <div key={si} className="flex gap-1">
                {sec.elements.map((el, ei) => {
                  if (el.type !== "seat") return <span key={ei} className="size-8 sm:size-9" aria-hidden />
                  const exit = el.characteristics.includes("EXIT_ROW")
                  const sel = chosen === el.designator
                  const cls = sel ? "bg-navy-950 text-white border-navy-950" : !el.available ? "bg-[repeating-linear-gradient(45deg,var(--color-line),var(--color-line)_3px,white_3px,white_6px)] text-steel border-line" : "border-success text-success bg-white"
                  return (
                    <button key={ei} type="button" disabled={!el.available} onClick={() => onChoose(el.designator)} aria-pressed={sel}
                      aria-label={`${el.designator}${el.available ? "" : `, ${t("itinerary.seatLegend.unavailable")}`}${exit ? `, ${t("itinerary.seatLegend.exit")}` : ""}`}
                      title={el.characteristics.join(", ")}
                      className={`flex size-8 flex-col items-center justify-center rounded-lg border text-[9px] font-semibold leading-none sm:size-9 ${cls} ${exit ? "ring-1 ring-offset-1 ring-danger/60" : ""}`}>
                      {el.designator}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap justify-center gap-3 text-xs text-steel">
        <li><span className="me-1 inline-block size-3 rounded border border-success align-middle" />{t("itinerary.seatLegend.available")}</li>
        <li><span className="me-1 inline-block size-3 rounded border border-orange-700 bg-warning-subtle align-middle" />{t("itinerary.seatLegend.paid")}</li>
        <li><span className="me-1 inline-block size-3 rounded border border-line bg-[repeating-linear-gradient(45deg,var(--color-line),var(--color-line)_2px,white_2px,white_4px)] align-middle" />{t("itinerary.seatLegend.unavailable")}</li>
        <li><span className="me-1 inline-block size-3 rounded bg-navy-950 align-middle" />{t("itinerary.seatLegend.selected")}</li>
        <li><span className="me-1 inline-block size-3 rounded ring-1 ring-danger/60 align-middle" />{t("itinerary.seatLegend.exit")}</li>
      </ul>
      <p className="mt-2 text-center text-xs text-steel" dir="auto">{t("itinerary.seatMapNote", { provider: map.source.provider, time: date(map.source.fetchedAt, { withTime: true }) })}</p>
    </div>
  )
}
