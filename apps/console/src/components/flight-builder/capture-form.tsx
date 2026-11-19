"use client"

import type { CapturedBaggage, CapturedCondition, FareType, FlightBuilderCaptureInput } from "@unitravel/contracts"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { Section } from "@/components/dev-ui"
import { Field } from "@/components/ui"
import { api } from "@/lib/api"
import { minorDigits } from "@unitravel/domain"
import { toMinor } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"

import { FB, FB_KEYS, ProblemBox } from "./shared"

type Tri3 = "KNOWN" | "NONE" | "UNKNOWN"
interface SegDraft { carrier: string; flightNumber: string; operatingCarrier: string; from: string; to: string; departLocal: string; arriveLocal: string; aircraft: string; durationMin: string }
interface PerSeg { bookingClass: string; seats: string; fareBasis: string; bag: Tri3; bagPieces: string; bagKg: string; bagSource: string; cabinBag: "YES" | "NO" | "UNKNOWN" }
interface CondDraft { state: CapturedCondition["state"]; penalty: string; source: string }
interface FareDraft { cabin: string; per: PerSeg[]; fareType: FareType; fareTypeRaw: string; base: string; taxes: string; total: string; currency: string; change: CondDraft; refund: CondDraft; rules: string; deadline: string }

const CABINS = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const
const FARE_TYPES: FareType[] = ["PUB", "NEGO", "TOP", "VFR", "OTHER"]
const up = (n: number) => (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n)
const blankSeg = (): SegDraft => ({ carrier: "", flightNumber: "", operatingCarrier: "", from: "", to: "", departLocal: "", arriveLocal: "", aircraft: "", durationMin: "" })
const blankPer = (): PerSeg => ({ bookingClass: "", seats: "", fareBasis: "", bag: "UNKNOWN", bagPieces: "1", bagKg: "", bagSource: "", cabinBag: "UNKNOWN" })
const blankCond = (): CondDraft => ({ state: "UNKNOWN", penalty: "", source: "" })
const blankFare = (n: number): FareDraft => ({ cabin: "ECONOMY", per: Array.from({ length: n }, blankPer), fareType: "PUB", fareTypeRaw: "", base: "", taxes: "", total: "", currency: "GBP", change: blankCond(), refund: blankCond(), rules: "", deadline: "" })
const localNow = () => { const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const opt = (v: string) => (v.trim() === "" ? undefined : v.trim())

const bagOf = (p: PerSeg, i: number): CapturedBaggage => {
  const checked: CapturedBaggage["checked"] = p.bag === "UNKNOWN" ? { status: "UNKNOWN" } : p.bag === "NONE" ? { status: "KNOWN", value: { pieces: 0 } } : { status: "KNOWN", value: { pieces: Number(p.bagPieces || 1), ...(p.bagKg ? { kgPerPiece: Number(p.bagKg) } : {}) } }
  const cabin: CapturedBaggage["cabin"] = p.cabinBag === "UNKNOWN" ? { status: "UNKNOWN" } : { status: "KNOWN", value: p.cabinBag === "YES" }
  return { segmentIndex: i, passengerType: "ADT", checked, cabin, ...(opt(p.bagSource) ? { sourceText: p.bagSource.trim() } : {}) }
}
const condOf = (c: CondDraft, currency: string): CapturedCondition => ({ state: c.state, ...(c.state !== "UNKNOWN" && c.penalty ? { penaltyMinor: toMinor(c.penalty, currency) } : {}), ...(opt(c.source) ? { sourceText: c.source.trim() } : {}) })

function buildInput(observedAt: string, sourceRecordId: string, note: string, requestRef: string | undefined, segs: SegDraft[], fares: FareDraft[]): FlightBuilderCaptureInput {
  return {
    observedAt: new Date(observedAt).toISOString(),
    ...(opt(sourceRecordId) ? { sourceRecordId: sourceRecordId.trim() } : {}), ...(opt(note) ? { note: note.trim() } : {}), ...(requestRef ? { requestRef } : {}),
    segments: segs.map((s) => ({ carrier: s.carrier, flightNumber: s.flightNumber, ...(s.operatingCarrier ? { operatingCarrier: s.operatingCarrier } : {}), from: s.from, to: s.to, departLocal: s.departLocal, arriveLocal: s.arriveLocal, ...(opt(s.aircraft) ? { aircraft: s.aircraft.trim() } : {}), ...(s.durationMin ? { durationMin: Number(s.durationMin) } : {}) })),
    fares: fares.map((f) => ({
      cabin: f.cabin as FlightBuilderCaptureInput["fares"][number]["cabin"], bookingClasses: f.per.map((p) => p.bookingClass), seats: f.per.map((p) => p.seats.trim()),
      fareBasis: f.per.every((p) => !p.fareBasis.trim()) ? [] : f.per.map((p) => p.fareBasis.trim()), fareType: f.fareType, ...(opt(f.fareTypeRaw) ? { fareTypeRaw: f.fareTypeRaw.trim() } : {}),
      ...(f.base !== "" ? { baseMinor: toMinor(f.base, f.currency) } : {}), ...(f.taxes !== "" ? { taxesMinor: toMinor(f.taxes, f.currency) } : {}), totalMinor: toMinor(f.total, f.currency), currency: f.currency,
      baggage: f.per.map((p, i) => bagOf(p, i)), change: condOf(f.change, f.currency), refund: condOf(f.refund, f.currency),
      ...(opt(f.rules) ? { rulesText: f.rules.trim() } : {}), ...(f.deadline ? { ticketingDeadline: f.deadline } : {}),
    })),
  }
}

/** Plain-language problems found before sending; the API stays the authority and its answer is shown as well. */
function localIssues(t: ReturnType<typeof useT>, segs: SegDraft[], fares: FareDraft[]): string[] {
  const out: string[] = []
  segs.forEach((s, i) => {
    const n = i + 1
    if (!/^[A-Z0-9]{2,3}$/.test(s.carrier)) out.push(t("fb.v.carrier", { n }))
    if (!/^\d{1,4}[A-Z]?$/.test(s.flightNumber)) out.push(t("fb.v.flightNo", { n }))
    if (s.from.length !== 3 || s.to.length !== 3) out.push(t("fb.v.airports", { n }))
    if (!s.departLocal || !s.arriveLocal) out.push(t("fb.v.times", { n }))
  })
  fares.forEach((f, i) => {
    const n = i + 1
    if (f.total === "" || !(Number(f.total) >= 0)) out.push(t("fb.v.total", { n }))
    if (!/^[A-Z]{3}$/.test(f.currency)) out.push(t("fb.v.currency", { n }))
    if (f.per.some((p) => !/^[A-Z]$/.test(p.bookingClass) || !p.seats.trim())) out.push(t("fb.v.classSeats", { n }))
    if (f.base !== "" && f.taxes !== "" && f.total !== "" && toMinor(f.base, f.currency) + toMinor(f.taxes, f.currency) !== toMinor(f.total, f.currency)) out.push(t("fb.v.sum", { n }))
  })
  return out
}

function TriSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return <Field label={label}><NativeSelect className="field-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</NativeSelect></Field>
}

function CondFields({ title, c, onChange, currency }: { title: string; c: CondDraft; onChange: (c: CondDraft) => void; currency: string }) {
  const t = useT()
  return (
    <fieldset className="grid gap-3 rounded-md border border-rule p-3 sm:grid-cols-3">
      <legend className="px-1 text-meta font-semibold text-ink">{title}</legend>
      <TriSelect label={t("fb.f.state")} value={c.state} onChange={(v) => onChange({ ...c, state: v as CondDraft["state"] })} options={[{ v: "KNOWN_ALLOWED", l: t("fb.tri.allowed") }, { v: "NOT_ALLOWED", l: t("fb.tri.notAllowed") }, { v: "UNKNOWN", l: t("fb.tri.unknown") }]} />
      <Field label={t("fb.f.penalty", { c: currency })}><input type="number" min={0} step="any" inputMode="decimal" className="field-input num" dir="ltr" disabled={c.state === "UNKNOWN"} value={c.penalty} onChange={(e) => onChange({ ...c, penalty: e.target.value })} /></Field>
      <Field label={t("fb.f.sourceText")}><input maxLength={500} className="field-input" dir="auto" placeholder={t("fb.f.sourceText.ph")} value={c.source} onChange={(e) => onChange({ ...c, source: e.target.value })} /></Field>
    </fieldset>
  )
}

export function CaptureForm({ requestRef }: { requestRef?: string }) {
  const t = useT()
  const qc = useQueryClient()
  const [observedAt, setObservedAt] = useState(localNow)
  const [sourceRecordId, setSourceRecordId] = useState("")
  const [note, setNote] = useState("")
  const [segs, setSegs] = useState<SegDraft[]>([blankSeg()])
  const [fares, setFares] = useState<FareDraft[]>([blankFare(1)])
  const [issues, setIssues] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const save = useMutation({
    mutationFn: () => api(`${FB}/options`, { body: buildInput(observedAt, sourceRecordId, note, requestRef, segs, fares) }),
    onSuccess: async () => { toast.success(t("fb.saved")); setDone(true); await qc.invalidateQueries({ queryKey: FB_KEYS.all }); if (requestRef) await qc.invalidateQueries({ queryKey: ["fr-detail", requestRef] }) },
  })
  // The fare repeater keeps one per-segment row for every segment, so adding or removing a segment resizes them together.
  const setSeg = (i: number, p: Partial<SegDraft>) => setSegs(segs.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const addSeg = () => { setSegs([...segs, blankSeg()]); setFares(fares.map((f) => ({ ...f, per: [...f.per, blankPer()] }))) }
  const rmSeg = (i: number) => { setSegs(segs.filter((_, j) => j !== i)); setFares(fares.map((f) => ({ ...f, per: f.per.filter((_, j) => j !== i) }))) }
  const setFare = (i: number, p: Partial<FareDraft>) => setFares(fares.map((f, j) => (j === i ? { ...f, ...p } : f)))
  const setPer = (fi: number, si: number, p: Partial<PerSeg>) => setFares(fares.map((f, j) => (j === fi ? { ...f, per: f.per.map((x, k) => (k === si ? { ...x, ...p } : x)) } : f)))
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const found = localIssues(t, segs, fares)
    setIssues(found)
    if (!found.length) save.mutate()
  }
  if (done) {
    return (
      <div className="rounded-xl border border-success-border bg-success-subtle p-5" role="status" data-testid="fb-saved">
        <p className="font-semibold text-success-subtle-fg">{t("fb.saved")}</p>
        <p className="mt-1 text-meta">{t("fb.saved.note")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {requestRef && <Button size="sm" nativeButton={false} render={<Link href={`/requests/${requestRef}`} />}>{t("fb.saved.back", { ref: requestRef })}</Button>}
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/catalog/flight-builder" />}>{t("fb.saved.list")}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setDone(false); setSegs([blankSeg()]); setFares([blankFare(1)]); setSourceRecordId(""); setNote(""); setObservedAt(localNow()); save.reset() }}>{t("fb.saved.another")}</Button>
        </div>
      </div>
    )
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-testid="fb-capture">
      <p className="rounded-md bg-surface-sunk px-3 py-2 text-meta text-steel">{t("fb.capture.note")}</p>
      {requestRef && <p className="text-meta">{t("fb.capture.forRequest")} <Link href={`/requests/${requestRef}`} className="ref font-semibold text-link hover:underline">{requestRef}</Link></p>}

      <Section title={t("fb.s.source")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("fb.f.observedAt")} hint={t("fb.f.observedAt.hint")}><input type="datetime-local" required className="field-input num" dir="ltr" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} /></Field>
          <Field label={t("fb.f.recordId")} hint={t("fb.f.recordId.hint")}><input maxLength={80} className="field-input" dir="ltr" value={sourceRecordId} onChange={(e) => setSourceRecordId(e.target.value)} /></Field>
          <Field label={t("fb.f.note")}><input maxLength={1000} className="field-input" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </Section>

      <Section title={t("fb.s.segments")} aside={segs.length < 6 && <Button type="button" size="xs" variant="outline" onClick={addSeg}>{t("fb.seg.add")}</Button>}>
        <div className="space-y-4">
          {segs.map((s, i) => (
            <fieldset key={i} className="rounded-md border border-rule p-3" aria-label={t("fb.seg.n", { n: i + 1 })}>
              <legend className="flex items-center gap-2 px-1 text-meta font-semibold text-ink">{t("fb.seg.n", { n: i + 1 })}{segs.length > 1 && <Button type="button" size="xs" variant="ghost" className="text-danger" onClick={() => rmSeg(i)}>{t("fb.remove")}</Button>}</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label={t("fb.f.carrier")}><input required className="field-input num uppercase" dir="ltr" placeholder="BA" value={s.carrier} onChange={(e) => setSeg(i, { carrier: up(3)(e.target.value) })} /></Field>
                <Field label={t("fb.f.flightNo")}><input required className="field-input num uppercase" dir="ltr" placeholder="136" maxLength={5} value={s.flightNumber} onChange={(e) => setSeg(i, { flightNumber: up(5)(e.target.value) })} /></Field>
                <Field label={t("fb.f.opCarrier")}><input className="field-input num uppercase" dir="ltr" value={s.operatingCarrier} onChange={(e) => setSeg(i, { operatingCarrier: up(3)(e.target.value) })} /></Field>
                <Field label={t("fb.f.aircraft")}><input maxLength={40} className="field-input" dir="ltr" placeholder="A320" value={s.aircraft} onChange={(e) => setSeg(i, { aircraft: e.target.value })} /></Field>
                <Field label={t("fb.f.from")}><input required className="field-input num uppercase" dir="ltr" placeholder="IKA" value={s.from} onChange={(e) => setSeg(i, { from: up(3)(e.target.value) })} /></Field>
                <Field label={t("fb.f.to")}><input required className="field-input num uppercase" dir="ltr" placeholder="LHR" value={s.to} onChange={(e) => setSeg(i, { to: up(3)(e.target.value) })} /></Field>
                <Field label={t("fb.f.depart")} hint={t("fb.f.localHint")}><input type="datetime-local" required className="field-input num" dir="ltr" value={s.departLocal} onChange={(e) => setSeg(i, { departLocal: e.target.value })} /></Field>
                <Field label={t("fb.f.arrive")} hint={t("fb.f.localHint")}><input type="datetime-local" required className="field-input num" dir="ltr" value={s.arriveLocal} onChange={(e) => setSeg(i, { arriveLocal: e.target.value })} /></Field>
                <Field label={t("fb.f.duration")}><input type="number" min={0} step={1} className="field-input num" dir="ltr" value={s.durationMin} onChange={(e) => setSeg(i, { durationMin: e.target.value })} /></Field>
              </div>
            </fieldset>
          ))}
        </div>
      </Section>

      <Section title={t("fb.s.fares")} aside={fares.length < 12 && <Button type="button" size="xs" variant="outline" onClick={() => setFares([...fares, blankFare(segs.length)])}>{t("fb.fare.add")}</Button>}>
        <div className="space-y-5">
          {fares.map((f, fi) => {
            const sum = f.base !== "" && f.taxes !== "" ? toMinor(f.base, f.currency) + toMinor(f.taxes, f.currency) : null
            const mismatch = sum !== null && f.total !== "" && sum !== toMinor(f.total, f.currency)
            const digits = /^[A-Z]{3}$/.test(f.currency) ? minorDigits(f.currency) : 2
            return (
              <fieldset key={fi} className="space-y-3 rounded-md border border-rule-strong p-3" aria-label={t("fb.fare.n", { n: fi + 1 })} data-testid="fb-fare">
                <legend className="flex items-center gap-2 px-1 text-meta font-semibold text-ink">{t("fb.fare.n", { n: fi + 1 })}{fares.length > 1 && <Button type="button" size="xs" variant="ghost" className="text-danger" onClick={() => setFares(fares.filter((_, j) => j !== fi))}>{t("fb.remove")}</Button>}</legend>
                <div className="grid gap-3 sm:grid-cols-4">
                  <TriSelect label={t("fb.f.cabin")} value={f.cabin} onChange={(v) => setFare(fi, { cabin: v })} options={CABINS.map((c) => ({ v: c, l: t(`fb.cabin.${c}` as MsgKey) }))} />
                  <TriSelect label={t("fb.f.fareType")} value={f.fareType} onChange={(v) => setFare(fi, { fareType: v as FareType })} options={FARE_TYPES.map((c) => ({ v: c, l: t(`fb.fareType.${c}` as MsgKey) }))} />
                  <Field label={t("fb.f.fareTypeRaw")} hint={t("fb.f.fareTypeRaw.hint")}><input maxLength={40} className="field-input" dir="auto" value={f.fareTypeRaw} onChange={(e) => setFare(fi, { fareTypeRaw: e.target.value })} /></Field>
                  <Field label={t("fb.f.deadline")}><input type="date" className="field-input num" dir="ltr" value={f.deadline} onChange={(e) => setFare(fi, { deadline: e.target.value })} /></Field>
                </div>

                <div className="space-y-3">
                  {f.per.map((p, si) => (
                    <div key={si} className="rounded-md bg-surface-sunk p-3" role="group" aria-label={t("fb.seg.n", { n: si + 1 })}>
                      <p className="mb-2 text-meta font-semibold text-steel"><bdi dir="ltr" className="num">{segs[si]?.carrier}{segs[si]?.flightNumber} {segs[si]?.from && segs[si]?.to ? `${segs[si]?.from} → ${segs[si]?.to}` : ""}</bdi> <span className="font-normal">({t("fb.seg.n", { n: si + 1 })})</span></p>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <Field label={t("fb.f.bookingClass")}><input required maxLength={1} className="field-input num uppercase" dir="ltr" placeholder="Y" value={p.bookingClass} onChange={(e) => setPer(fi, si, { bookingClass: up(1)(e.target.value) })} /></Field>
                        <Field label={t("fb.f.seats")} hint={t("fb.f.seats.hint")}><input required maxLength={8} className="field-input num" dir="ltr" placeholder="4" value={p.seats} onChange={(e) => setPer(fi, si, { seats: e.target.value })} /></Field>
                        <Field label={t("fb.f.fareBasis")}><input maxLength={20} className="field-input num uppercase" dir="ltr" value={p.fareBasis} onChange={(e) => setPer(fi, si, { fareBasis: e.target.value.toUpperCase() })} /></Field>
                        <TriSelect label={t("fb.f.cabinBag")} value={p.cabinBag} onChange={(v) => setPer(fi, si, { cabinBag: v as PerSeg["cabinBag"] })} options={[{ v: "YES", l: t("fb.tri.included") }, { v: "NO", l: t("fb.tri.notIncluded") }, { v: "UNKNOWN", l: t("fb.tri.unknown") }]} />
                        <TriSelect label={t("fb.f.bag")} value={p.bag} onChange={(v) => setPer(fi, si, { bag: v as Tri3 })} options={[{ v: "KNOWN", l: t("fb.tri.included") }, { v: "NONE", l: t("fb.tri.notIncluded") }, { v: "UNKNOWN", l: t("fb.tri.unknown") }]} />
                        <Field label={t("fb.f.bagPieces")}><input type="number" min={1} step={1} className="field-input num" dir="ltr" disabled={p.bag !== "KNOWN"} value={p.bagPieces} onChange={(e) => setPer(fi, si, { bagPieces: e.target.value })} /></Field>
                        <Field label={t("fb.f.bagKg")}><input type="number" min={0} step="any" className="field-input num" dir="ltr" disabled={p.bag !== "KNOWN"} value={p.bagKg} onChange={(e) => setPer(fi, si, { bagKg: e.target.value })} /></Field>
                        <Field label={t("fb.f.bagSource")}><input maxLength={300} className="field-input" dir="auto" placeholder={t("fb.f.sourceText.ph")} value={p.bagSource} onChange={(e) => setPer(fi, si, { bagSource: e.target.value })} /></Field>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label={t("fb.f.currency")}><input required maxLength={3} className="field-input num uppercase" dir="ltr" value={f.currency} onChange={(e) => setFare(fi, { currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} /></Field>
                  <Field label={t("fb.f.base")}><input type="number" min={0} step={10 ** -digits} inputMode="decimal" className="field-input num" dir="ltr" value={f.base} onChange={(e) => setFare(fi, { base: e.target.value })} /></Field>
                  <Field label={t("fb.f.taxes")}><input type="number" min={0} step={10 ** -digits} inputMode="decimal" className="field-input num" dir="ltr" value={f.taxes} onChange={(e) => setFare(fi, { taxes: e.target.value })} /></Field>
                  <Field label={t("fb.f.total")}><input type="number" required min={0} step={10 ** -digits} inputMode="decimal" className="field-input num" dir="ltr" aria-invalid={mismatch || undefined} value={f.total} onChange={(e) => setFare(fi, { total: e.target.value })} /></Field>
                </div>
                {sum !== null && <p role="status" className={mismatch ? "text-meta font-medium text-danger" : "text-meta text-success"} data-testid="fb-sum">{mismatch ? t("fb.f.sum.bad", { sum: (sum / 10 ** digits).toFixed(digits), c: f.currency }) : t("fb.f.sum.ok")}</p>}

                <div className="grid gap-3 lg:grid-cols-2">
                  <CondFields title={t("fb.f.change")} c={f.change} currency={f.currency} onChange={(c) => setFare(fi, { change: c })} />
                  <CondFields title={t("fb.f.refund")} c={f.refund} currency={f.currency} onChange={(c) => setFare(fi, { refund: c })} />
                </div>
                <Field label={t("fb.f.rules")} hint={t("fb.f.rules.hint")}><textarea maxLength={8000} className="field-input" dir="auto" value={f.rules} onChange={(e) => setFare(fi, { rules: e.target.value })} /></Field>
              </fieldset>
            )
          })}
        </div>
      </Section>

      {issues.length > 0 && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-meta text-danger" data-testid="fb-issues">
          <p className="font-semibold">{t("fb.v.title")}</p>
          <ul className="list-disc ps-5">{issues.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      <ProblemBox error={save.error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending} data-testid="fb-submit">{t("fb.submit")}</Button>
        <Button type="button" variant="ghost" nativeButton={false} render={<Link href={requestRef ? `/requests/${requestRef}` : "/catalog/flight-builder"} />}>{t("common.cancel")}</Button>
      </div>
    </form>
  )
}
