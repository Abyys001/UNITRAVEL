"use client"

import type { SeatMap } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"

/**
 * Seat map rendering rules (ch. 7.4): rows and sections exactly as supplied, a designator on every seat, text and
 * patterns rather than colour alone, the cabin never mirrored in Persian (nose at the top), 32 px minimum targets.
 */
export function SeatMapView({ map, chosen, onChoose }: { map: SeatMap; chosen?: string; onChoose: (d: string) => void }) {
  const { t, money, date } = useI18n()
  const cabin = map.cabins[0]
  if (!cabin) return null
  return (
    <div dir="ltr" className="rounded-lg border border-border bg-white p-3">
      <p className="mb-2 text-center text-xs uppercase tracking-widest text-slate">▲ front</p>
      <div className="mx-auto max-h-[520px] w-fit overflow-auto px-2">
        {cabin.rows.map((row, ri) => (
          <div key={ri} className="flex items-center justify-center gap-5 py-0.5">
            {row.sections.map((sec, si) => (
              <div key={si} className="flex gap-1">
                {sec.elements.map((el, ei) => {
                  if (el.type !== "seat") return <span key={ei} className="size-8 sm:size-9" aria-hidden />
                  const exit = el.characteristics.includes("EXIT_ROW")
                  const sel = chosen === el.designator
                  const cls = sel ? "bg-ink text-white border-ink" : !el.available ? "bg-[repeating-linear-gradient(45deg,#e6e1d8,#e6e1d8_3px,#fff_3px,#fff_6px)] text-slate/60 border-mist" : el.price ? "border-copper text-copper-700 bg-accent" : "border-moss/60 text-moss bg-white"
                  return (
                    <button key={ei} type="button" disabled={!el.available} onClick={() => onChoose(el.designator)} aria-pressed={sel}
                      aria-label={`${el.designator}${el.price ? `, ${money(el.price)}` : ""}${el.available ? "" : `, ${t("itinerary.seatLegend.unavailable")}`}${exit ? `, ${t("itinerary.seatLegend.exit")}` : ""}`}
                      title={el.characteristics.join(", ")}
                      className={`flex size-8 flex-col items-center justify-center rounded border text-[9px] font-semibold leading-none sm:size-9 ${cls} ${exit ? "ring-1 ring-offset-1 ring-brick/50" : ""}`}>
                      {el.designator}{el.price && el.available && <span className="mt-0.5 text-[8px] font-normal">{money(el.price)}</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap justify-center gap-3 text-xs text-slate">
        <li><span className="me-1 inline-block size-3 rounded border border-moss/60 align-middle" />{t("itinerary.seatLegend.available")}</li>
        <li><span className="me-1 inline-block size-3 rounded border border-copper bg-accent align-middle" />{t("itinerary.seatLegend.paid")}</li>
        <li><span className="me-1 inline-block size-3 rounded border border-mist bg-[repeating-linear-gradient(45deg,#e6e1d8,#e6e1d8_2px,#fff_2px,#fff_4px)] align-middle" />{t("itinerary.seatLegend.unavailable")}</li>
        <li><span className="me-1 inline-block size-3 rounded bg-ink align-middle" />{t("itinerary.seatLegend.selected")}</li>
        <li><span className="me-1 inline-block size-3 rounded ring-1 ring-brick/50 align-middle" />{t("itinerary.seatLegend.exit")}</li>
      </ul>
      <p className="mt-2 text-center text-xs text-slate" dir="auto">{t("itinerary.seatMapNote", { provider: map.source.provider, time: date(map.source.fetchedAt, { withTime: true }) })}</p>
    </div>
  )
}
