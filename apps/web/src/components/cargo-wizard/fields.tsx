"use client"

import { ArrowRight, Check, CircleAlert, FileText, Plus, Trash2, Upload, X } from "lucide-react"
import { useState } from "react"

import { Input } from "@unitravel/ui/components/input"
import { CountryFlag } from "@unitravel/ui/product/country"

import { CounterField, fieldAria, FieldShell, type FieldErrors, type FieldMessages, SelectField } from "@/components/form"
import { COUNTRIES, countryName } from "@/lib/countries"
import { useI18n } from "@/lib/i18n"
import { uploadFile } from "@/lib/upload"

import { CATEGORIES, type CargoValues, type Item, type Lane, newItem, newPiece, type Party, type Piece, PURPOSES, SERVICES } from "./model"

const control = "h-11 rounded-xl border-line bg-cloud px-3 text-base text-navy-950 shadow-none focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 aria-invalid:border-danger"
const addBtn = "inline-flex min-h-11 items-center gap-2 rounded-full border border-navy-900 px-4 text-sm font-semibold text-navy-900 outline-none transition-colors hover:bg-navy-950 hover:text-white focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:opacity-50"
const removeBtn = "grid size-11 shrink-0 place-items-center rounded-full text-steel outline-none transition-colors hover:bg-danger/10 hover:text-danger focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:opacity-40"
const card = "rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]"

export function useNum() {
  const { locale } = useI18n()
  const f = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB", { maximumFractionDigits: 2 })
  return (n: number) => f.format(n)
}

/** A number in the visitor's digits, kept left to right inside Persian text. */
export function Num({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr" className="tabular-nums">{children}</bdi>
}

interface TextFieldProps extends FieldMessages { id: string; label: React.ReactNode; value: string; onChange: (v: string) => void; ltr?: boolean; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string; className?: string }

export function TextField({ id, label, value, onChange, ltr, type = "text", inputMode, autoComplete, className, ...msg }: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} className={className} {...msg}>
      <Input id={id} type={type} inputMode={inputMode} autoComplete={autoComplete} dir={ltr ? "ltr" : "auto"} value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 w-full ${control}`} {...fieldAria(id, msg)} />
    </FieldShell>
  )
}

/** Decimal entry (cm, kg, pounds). An emptied box holds NaN so the step check reports it instead of sending 0. */
function NumberField({ id, label, value, onChange, min, step = "0.1", ...msg }: FieldMessages & { id: string; label: React.ReactNode; value: number; onChange: (n: number) => void; min?: number; step?: string }) {
  return (
    <FieldShell id={id} label={label} className="text-xs text-steel" {...msg}>
      <Input id={id} type="number" inputMode="decimal" dir="ltr" min={min} step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))} className={`mt-1 w-full tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${control}`} {...fieldAria(id, msg)} />
    </FieldShell>
  )
}

const countryOptions = (cur: string, locale: string) => (COUNTRIES.includes(cur) ? COUNTRIES : [...COUNTRIES, cur]).map((c) => ({ value: c, label: countryName(c, locale) }))

/* ---------- Step 1: route ---------- */

export function LaneCards({ lanes, value, error, onPick }: { lanes: Lane[]; value: string; error?: string; onPick: (l: Lane) => void }) {
  const { t, locale } = useI18n()
  return (
    <fieldset aria-describedby={error ? "laneId-error" : undefined}>
      <legend className="sr-only">{t("cargo.lane")}</legend>
      {error ? <p id="laneId-error" className="mb-3 flex items-center gap-1.5 text-sm font-medium text-danger"><CircleAlert className="size-4" aria-hidden />{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {lanes.map((l) => {
          const selected = l.id === value
          return (
            <label key={l.id} className={`relative flex min-h-24 flex-col gap-2 rounded-2xl border p-4 transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-royal/50 ${!l.enabled ? "cursor-not-allowed border-dashed border-line bg-cloud/60" : selected ? "cursor-pointer border-orange bg-orange/5 shadow-[var(--shadow-card)]" : "cursor-pointer border-line bg-white hover:border-steel/50"}`}>
              <input type="radio" name="cargo-lane" value={l.id} checked={selected} disabled={!l.enabled} onChange={() => onPick(l)} className="sr-only" aria-invalid={error && l.enabled ? true : undefined} aria-describedby={l.notice ? `lane-notice-${l.id}` : undefined} />
              <span className="flex items-center gap-2 text-base font-semibold text-navy-950">
                <CountryFlag code={l.originCountry} size={22} />
                <span className="min-w-0 truncate">{countryName(l.originCountry, locale)}</span>
                <ArrowRight className="size-4 shrink-0 text-steel rtl:rotate-180" aria-hidden />
                <CountryFlag code={l.destinationCountry} size={22} />
                <span className="min-w-0 truncate">{countryName(l.destinationCountry, locale)}</span>
                {selected ? <Check className="ms-auto size-5 shrink-0 text-orange" aria-hidden /> : null}
              </span>
              <span className="text-xs text-steel">{l.label}</span>
              {!l.enabled ? <span className="w-fit rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-steel ring-1 ring-line">{t("cargo.laneDisabled")}</span> : null}
              {l.notice ? <span id={`lane-notice-${l.id}`} className="text-sm text-navy-900">{l.notice}</span> : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/* ---------- Step 2: service ---------- */

export function ServiceCards({ lane, value, error, onPick }: { lane: Lane; value: string; error?: string; onPick: (s: string) => void }) {
  const { t } = useI18n()
  const allowed = SERVICES.filter((s) => lane.services.includes(s))
  return (
    <fieldset aria-describedby={error ? "service-error" : undefined}>
      <legend className="sr-only">{t("cargo.service")}</legend>
      {error ? <p id="service-error" className="mb-3 flex items-center gap-1.5 text-sm font-medium text-danger"><CircleAlert className="size-4" aria-hidden />{error}</p> : null}
      {allowed.length === 0 ? <p className="rounded-xl bg-cloud px-4 py-3 text-sm text-steel">{t("guide.cargo.noServices")}</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {allowed.map((s) => {
          const selected = s === value
          return (
            <label key={s} className={`flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-royal/50 ${selected ? "border-orange bg-orange/5 shadow-[var(--shadow-card)]" : "border-line bg-white hover:border-steel/50"}`}>
              <input type="radio" name="cargo-service" value={s} checked={selected} onChange={() => onPick(s)} className="sr-only" aria-invalid={error ? true : undefined} />
              <span className="flex items-center justify-between gap-2 text-base font-semibold text-navy-950">{t(`cargo.${s}`)}{selected ? <Check className="size-5 shrink-0 text-orange" aria-hidden /> : null}</span>
              <span className="text-sm text-navy-900"><span className="font-semibold">{t("guide.cargo.suits")}: </span>{t(`guide.cargo.services.${s}.suits`)}</span>
              <span className="text-sm text-steel"><span className="font-semibold text-navy-900">{t("guide.cargo.needs")}: </span>{t(`guide.cargo.services.${s}.needs`)}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/* ---------- Step 3: shipment ---------- */

export function PieceRows({ pieces, errors, set }: { pieces: Piece[]; errors: FieldErrors; set: (p: Piece[]) => void }) {
  const { t } = useI18n()
  const num = useNum()
  const dims = [["lengthCm", "cargo.length"], ["widthCm", "cargo.width"], ["heightCm", "cargo.height"], ["weightKg", "cargo.weight"]] as const
  return (
    <div className="grid gap-3">
      {pieces.map((p, i) => (
        <div key={i} className={card}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-navy-950">{t("guide.cargo.pieceN", { n: num(i + 1) })}</p>
            <button type="button" className={removeBtn} aria-label={t("guide.cargo.removePiece", { n: num(i + 1) })} disabled={pieces.length === 1} onClick={() => set(pieces.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></button>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-3 md:grid-cols-4">
            {dims.map(([k, label]) => (
              <NumberField key={k} id={`pieces.${i}.${k}`} label={t(label)} value={p[k]} min={0.1} required error={errors[`pieces.${i}.${k}`]} onChange={(n) => set(pieces.map((x, j) => (j === i ? { ...x, [k]: n } : x)))} />
            ))}
          </div>
        </div>
      ))}
      <div><button type="button" className={addBtn} disabled={pieces.length >= 50} onClick={() => set([...pieces, newPiece()])}><Plus className="size-4" aria-hidden />{t("cargo.addPiece")}</button></div>
    </div>
  )
}

export function WeightEstimate({ w, divisor }: { w: { actual: number; vol: number; charge: number }; divisor: number }) {
  const { t } = useI18n()
  const num = useNum()
  const cells = [["guide.cargo.estActual", w.actual], ["guide.cargo.estVol", w.vol], ["guide.cargo.estCharge", w.charge]] as const
  return (
    <div className="rounded-2xl bg-cloud p-4" aria-live="polite">
      <dl className="grid grid-cols-3 gap-2">
        {cells.map(([k, v], i) => (
          <div key={k} className={i === 2 ? "rounded-xl bg-white px-2 py-1.5 ring-1 ring-orange/40" : "px-2 py-1.5"}>
            <dt className="text-xs text-steel">{t(k)}</dt>
            <dd className="text-base font-semibold text-navy-950"><Num>{num(v)}</Num> {t("guide.cargo.kgUnit")}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-steel">{t("guide.cargo.estNote")} <Num>{`L × W × H ÷ ${divisor}`}</Num></p>
    </div>
  )
}

export function ItemRows({ items, errors, freight, set, defaultOrigin }: { items: Item[]; errors: FieldErrors; freight: boolean; set: (i: Item[]) => void; defaultOrigin: string }) {
  const { t, locale } = useI18n()
  const num = useNum()
  const upd = (i: number, p: Partial<Item>) => set(items.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <div className="grid gap-3">
      {items.map((it, i) => {
        const hsErr = errors[`items.${i}.hsCode`]
        return (
          <div key={i} className={card}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-navy-950">{t("guide.cargo.itemN", { n: num(i + 1) })}</p>
              <button type="button" className={removeBtn} aria-label={t("guide.cargo.removeItem", { n: num(i + 1) })} disabled={items.length === 1} onClick={() => set(items.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></button>
            </div>
            <div className="mt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <TextField id={`items.${i}.description`} className="text-sm sm:col-span-2 lg:col-span-3" label={t("cargo.description")} hint={t("guide.cargo.descriptionHint")} required value={it.description} error={errors[`items.${i}.description`]} onChange={(v) => upd(i, { description: v })} />
              <SelectField id={`items.${i}.category`} label={t("cargo.category")} value={it.category} error={errors[`items.${i}.category`]} options={CATEGORIES.map((c) => ({ value: c, label: t(`cargo.categories.${c}`) }))} onChange={(v) => upd(i, { category: v })} />
              <SelectField id={`items.${i}.purpose`} label={t("cargo.purpose")} value={it.purpose} error={errors[`items.${i}.purpose`]} options={PURPOSES.map((c) => ({ value: c, label: t(`cargo.purposes.${c}`) }))} onChange={(v) => upd(i, { purpose: v })} />
              <SelectField id={`items.${i}.originCountry`} label={t("cargo.origin")} value={it.originCountry} error={errors[`items.${i}.originCountry`]} options={countryOptions(it.originCountry, locale)} onChange={(v) => upd(i, { originCountry: v })} />
              <CounterField id={`items.${i}.quantity`} variant="field" label={t("cargo.quantity")} min={1} max={10000} value={it.quantity} error={errors[`items.${i}.quantity`]} onChange={(n) => upd(i, { quantity: n })} />
              <NumberField id={`items.${i}.value`} label={t("guide.cargo.unitValueGbp")} min={0} step="0.01" value={it.value} required error={errors[`items.${i}.value`]} onChange={(n) => upd(i, { value: n })} />
              <TextField id={`items.${i}.hsCode`} className="text-xs text-steel" label={t("cargo.hs")} ltr inputMode="numeric" required={freight} optional={!freight} hint={t("guide.cargo.hsHint")}
                value={it.hsCode} error={hsErr && it.hsCode ? t("guide.cargo.hsError") : hsErr} onChange={(v) => upd(i, { hsCode: v.replace(/\D/g, "") })} />
            </div>
          </div>
        )
      })}
      <div><button type="button" className={addBtn} disabled={items.length >= 100} onClick={() => set([...items, newItem(defaultOrigin)])}><Plus className="size-4" aria-hidden />{t("cargo.addItem")}</button></div>
    </div>
  )
}

/* ---------- Step 4: contact and documents ---------- */

/** Module scope: a component declared inside a step renderer would remount on every keystroke and drop focus. */
export function PartyFields({ role, v, set, freight, errors, phoneFallback }: { role: "shipper" | "consignee"; v: Party; set: (p: Party) => void; freight: boolean; errors: FieldErrors; phoneFallback: boolean }) {
  const { t, locale } = useI18n()
  const e = (k: string) => errors[`${role}.${k}`]
  const addr = (p: Partial<Party["address"]>) => set({ ...v, address: { ...v.address, ...p } })
  const nameErr = e("name")
  return (
    <fieldset className={`${card} grid gap-3 sm:grid-cols-2`}>
      <legend className="font-display float-start mb-1 w-full text-lg text-navy-950">{t(`cargo.${role}`)}</legend>
      <TextField id={`${role}.name`} label={t("cargo.name")} ltr required autoComplete="name" hint={t("guide.cargo.latinHint")} value={v.name}
        error={nameErr && v.name.trim() ? t("guide.cargo.latinError") : nameErr} onChange={(x) => set({ ...v, name: x })} />
      <TextField id={`${role}.company`} label={t("cargo.company")} required={freight} optional={!freight} hint={freight ? t("guide.cargo.companyFreight") : undefined} autoComplete="organization" value={v.company} error={e("company")} onChange={(x) => set({ ...v, company: x })} />
      <TextField id={`${role}.address.line1`} className="text-sm sm:col-span-2" label={t("cargo.address")} required autoComplete="street-address" value={v.address.line1} error={e("address.line1")} onChange={(x) => addr({ line1: x })} />
      <TextField id={`${role}.address.city`} label={t("cargo.city")} required value={v.address.city} error={e("address.city")} onChange={(x) => addr({ city: x })} />
      <TextField id={`${role}.address.postcode`} label={t("cargo.postcode")} optional ltr value={v.address.postcode} error={e("address.postcode")} onChange={(x) => addr({ postcode: x })} />
      <SelectField id={`${role}.address.country`} label={t("cargo.country")} required value={v.address.country} error={e("address.country")} options={countryOptions(v.address.country, locale)} onChange={(x) => addr({ country: x })} />
      <TextField id={`${role}.phone`} label={t("cargo.phone")} type="tel" inputMode="tel" ltr optional={phoneFallback} required={!phoneFallback} hint={phoneFallback ? t("guide.cargo.phoneHint") : undefined} value={v.phone} error={e("phone")} onChange={(x) => set({ ...v, phone: x })} />
      <TextField id={`${role}.email`} className="text-sm sm:col-span-2" label={t("cargo.email")} type="email" inputMode="email" ltr optional value={v.email} error={e("email")} onChange={(x) => set({ ...v, email: x })} />
    </fieldset>
  )
}

export function DocumentsField({ signedIn, docs, set, error }: { signedIn: boolean; docs: CargoValues["docs"]; set: (d: CargoValues["docs"]) => void; error?: string }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const onFile = async (f: File | undefined) => {
    if (!f) return
    setBusy(true); setFailed(false)
    try { set([...docs, await uploadFile(f, "OTHER")]) } catch { setFailed(true) } finally { setBusy(false) }
  }
  return (
    <section aria-labelledby="cargo-docs-title" className={card}>
      <h3 id="cargo-docs-title" className="font-display text-lg text-navy-950">{t("cargo.documents")}</h3>
      <p className="mt-1 text-sm text-steel">{signedIn ? t("guide.cargo.docsHint") : t("guide.cargo.docsSignedOut")}</p>
      {signedIn ? (
        <>
          <label className={`${addBtn} mt-3 cursor-pointer has-focus-visible:ring-[3px] has-focus-visible:ring-royal/50 ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <Upload className="size-4" aria-hidden />{busy ? t("guide.cargo.uploading") : t("cargo.upload")}
            <input id="docs" type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={busy} aria-invalid={error ? true : undefined} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = "" }} />
          </label>
          {failed || error ? <p role="alert" className="mt-2 text-sm font-medium text-danger">{error ?? t("guide.cargo.uploadFailed")}</p> : null}
          {docs.length ? (
            <ul className="mt-3 grid gap-2">
              {docs.map((d) => (
                <li key={d.documentId} className="flex items-center gap-2 rounded-xl bg-cloud px-3 py-1 text-sm text-navy-900">
                  <FileText className="size-4 shrink-0 text-steel" aria-hidden /><span dir="auto" className="min-w-0 flex-1 truncate">{d.filename}</span>
                  <button type="button" className={removeBtn} aria-label={t("guide.cargo.removeDoc", { name: d.filename })} onClick={() => set(docs.filter((x) => x.documentId !== d.documentId))}><X className="size-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
