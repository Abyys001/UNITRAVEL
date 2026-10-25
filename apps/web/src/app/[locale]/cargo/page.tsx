"use client"

import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Plus, Trash2, Upload } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { IconBadge } from "@unitravel/ui/brand/art"
import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { api, ApiError, newIdempotencyKey } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { COUNTRIES, countryName } from "@/lib/countries"
import { uploadFile } from "@/lib/upload"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

interface Lane { id: string; originCountry: string; destinationCountry: string; label: string; enabled: boolean; services: string[]; volumetricDivisor: number; notice: string | null }
const CATS = ["DOCUMENTS", "CLOTHING", "PERSONAL_EFFECTS", "BOOKS", "FOOD_NON_PERISHABLE", "COSMETICS", "MEDICINES", "MEDICAL_DEVICES", "ELECTRONICS", "LITHIUM_BATTERIES", "AIRCRAFT_VEHICLE_INDUSTRIAL_PARTS", "JEWELLERY_ART", "OTHER"]
const PURPOSES = ["PERSONAL_EFFECTS", "GIFT", "DOCUMENTS", "SALE", "SAMPLE", "RETURN"]
const emptyParty = (country: string) => ({ name: "", company: "", line1: "", city: "", postcode: "", country, phone: "", email: "" })

type Party = ReturnType<typeof emptyParty>

const countryOptions = (cur: string, locale: "en" | "fa") => (COUNTRIES.includes(cur) ? COUNTRIES : [...COUNTRIES, cur]).map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)

/** Module scope on purpose: declared inside the page it is a new component type every render and the inputs lose focus per keystroke. */
function PartyFields({ title, v, set, freight }: { title: string; v: Party; set: (x: Party) => void; freight: boolean }) {
  const { t, locale } = useI18n()
  return (
    <fieldset className="grid gap-2 card-brand p-4 sm:grid-cols-2"><legend className="font-display px-1 text-lg">{title}</legend>
      {(["name", "company", "line1", "city", "postcode", "phone", "email"] as const).map((k) => (
        <label key={k} className="text-sm">{t(k === "line1" ? "cargo.address" : `cargo.${k}` as never)}{k === "company" && !freight && <span className="text-steel"> ({t("common.optional")})</span>}
          <Input className="mt-1 h-10" dir={["phone", "email", "postcode"].includes(k) || k === "name" ? "ltr" : "auto"} value={v[k]} onChange={(e) => set({ ...v, [k]: e.target.value })} required={k === "name" || k === "line1" || k === "city" || (k === "company" && freight)} />
        </label>
      ))}
      <label className="text-sm">{t("cargo.country")}<NativeSelect className="field mt-1 h-10 w-full" value={v.country} onChange={(e) => set({ ...v, country: e.target.value })}>{countryOptions(v.country, locale)}</NativeSelect></label>
    </fieldset>
  )
}

export default function CargoPage() {
  const { t, href, money, sep, locale } = useI18n()
  const { me } = useRequireSignIn()
  const lanes = useQuery({ queryKey: ["lanes"], queryFn: () => api<Lane[]>("/v1/cargo/lanes") })
  const [laneId, setLaneId] = useState("")
  const [service, setService] = useState("PARCEL")
  const lane = lanes.data?.find((l) => l.id === laneId)
  const [shipper, setShipper] = useState(emptyParty("GB"))
  const [consignee, setConsignee] = useState(emptyParty("TR"))
  const [pieces, setPieces] = useState([{ lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 5 }])
  const [items, setItems] = useState([{ description: "", category: "CLOTHING", quantity: 1, value: 50, originCountry: "GB", hsCode: "", purpose: "PERSONAL_EFFECTS" }])
  const [decl, setDecl] = useState({ batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false })
  const [readyDate, setReadyDate] = useState(new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10))
  const [handover, setHandover] = useState("PICKUP")
  const [incoterm, setIncoterm] = useState("DAP")
  const [docs, setDocs] = useState<{ documentId: string; filename: string }[]>([])
  const [consent, setConsent] = useState({ accuracy: false, prohibitedItems: false, privacy: false })
  const [err, setErr] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [key] = useState(newIdempotencyKey)
  const divisor = lane?.volumetricDivisor ?? 5000
  // Shown live and labelled an estimate (ch. 14.3): volumetric = L × W × H ÷ divisor; chargeable = the greater.
  const w = useMemo(() => {
    const actual = pieces.reduce((s, p) => s + p.weightKg, 0)
    const vol = pieces.reduce((s, p) => s + (p.lengthCm * p.widthCm * p.heightCm) / divisor, 0)
    const r = (n: number) => Math.round(n * 100) / 100
    return { actual: r(actual), vol: r(vol), charge: r(Math.max(actual, vol)) }
  }, [pieces, divisor])
  const freight = service === "AIR_FREIGHT"
  const phone = me?.identities.find((i) => i.type === "PHONE" && i.verifiedAt)
  const total = items.reduce((s, i) => s + Math.round(i.value * 100) * i.quantity, 0)
  const party = (p: typeof shipper) => ({ name: p.name, company: p.company || undefined, address: { line1: p.line1, city: p.city, postcode: p.postcode || undefined, country: p.country }, phone: p.phone || phone?.value || "", email: p.email || undefined })
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await api<{ ref: string }>("/v1/cargo-requests", { headers: { "idempotency-key": key }, body: {
        service, laneId, shipperIdentityId: phone?.id, shipper: party(shipper), consignee: party(consignee), readyDate, handoverMode: handover, pieces,
        items: items.map((i) => ({ description: i.description, category: i.category, quantity: i.quantity, unitValue: { amountMinor: Math.round(i.value * 100), currency: "GBP" }, originCountry: i.originCountry, hsCode: i.hsCode || undefined, purpose: i.purpose })),
        commercial: freight ? { incoterm } : undefined, declarations: decl, declaredTotal: { amountMinor: total, currency: "GBP" }, documentIds: docs.map((d) => d.documentId), consents: consent,
      } })
      setDone(r.ref)
    } catch (e) { setErr(e as ApiError) } finally { setBusy(false) }
  }
  // On a phone the form is long: bring the result into view.
  useEffect(() => { if (done) window.scrollTo({ top: 0, behavior: "smooth" }) }, [done])
  if (done) return (
    <div className="mx-auto max-w-xl px-4 py-12"><div className="card-brand p-8 text-center"><IconBadge className="mx-auto border-success text-success"><CheckCircle2 /></IconBadge><h1 className="font-display mt-5 text-3xl md:text-4xl">{t("request.sentTitle")}</h1><p className="mt-4 inline-block rounded-xl bg-cloud px-4 py-2 font-mono text-2xl" dir="ltr">{done}</p><div><Link href={href(`/cargo/${done}`)} className="btn-orange mt-6">{t("cargo.tracking")}</Link></div></div></div>
  )
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("cargo.title")}</h1>
      <p className="card-brand mt-4 max-w-2xl !rounded-xl border-s-4 !border-s-danger px-4 py-3 text-sm">{t("cargo.prohibited")}</p>
      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">{t("cargo.lane")}
          <NativeSelect className="mt-1 h-11 w-full field" value={laneId} onChange={(e) => { setLaneId(e.target.value); const l = lanes.data?.find((x) => x.id === e.target.value); if (l) { setShipper((s) => ({ ...s, country: l.originCountry })); setConsignee((c) => ({ ...c, country: l.destinationCountry })) } }}>
            <option value="">—</option>
            {lanes.data?.map((l) => <option key={l.id} value={l.id} disabled={!l.enabled}>{l.label}{!l.enabled ? `${sep}${t("cargo.laneDisabled")}` : ""}</option>)}
          </NativeSelect>
        </label>
        <label className="text-sm font-medium">{t("cargo.service")}
          <NativeSelect className="mt-1 h-11 w-full field" value={service} onChange={(e) => setService(e.target.value)}>
            {(lane?.services ?? ["DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE", "AIR_FREIGHT"]).map((s) => <option key={s} value={s}>{t(`cargo.${s}` as never)}</option>)}
          </NativeSelect>
        </label>
        {lane?.notice && <p className="text-sm text-steel sm:col-span-2">{lane.notice}</p>}
      </section>
      <div className="mt-6 grid gap-4 md:grid-cols-2"><PartyFields title={t("cargo.shipper")} v={shipper} set={setShipper} freight={freight} /><PartyFields title={t("cargo.consignee")} v={consignee} set={setConsignee} freight={freight} /></div>
      <section className="mt-6 card-brand p-4">
        <h2 className="font-display text-lg">{t("cargo.pieces")}</h2>
        {pieces.map((p, i) => (
          <div key={i} className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
            {(["lengthCm", "widthCm", "heightCm", "weightKg"] as const).map((k) => <label key={k} className="text-xs text-steel">{t(`cargo.${k === "lengthCm" ? "length" : k === "widthCm" ? "width" : k === "heightCm" ? "height" : "weight"}`)}<Input type="number" inputMode="decimal" min={0.1} step="0.1" className="mt-1 h-10 text-base text-navy-950 sm:text-sm" value={p[k]} onChange={(e) => setPieces(pieces.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)))} /></label>)}
            <Button variant="ghost" className="col-span-2 sm:col-span-1" aria-label={t("common.remove")} disabled={pieces.length === 1} onClick={() => setPieces(pieces.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="rounded-xl border-navy-900 text-navy-900 mt-3" onClick={() => setPieces([...pieces, { lengthCm: 30, widthCm: 20, heightCm: 20, weightKg: 3 }])}><Plus className="size-4" />{t("cargo.addPiece")}</Button>
        <p className="mt-3 rounded-xl bg-cloud px-4 py-2.5 text-sm font-medium" aria-live="polite">{t("cargo.weights", { actual: w.actual, vol: w.vol, charge: w.charge })}</p>
      </section>
      <section className="mt-6 card-brand p-4">
        <h2 className="font-display text-lg">{t("cargo.items")}</h2>
        {items.map((it, i) => (
          <div key={i} className="mt-3 grid gap-2 border-t border-line pt-3 first:border-0 sm:grid-cols-6">
            <label className="text-xs text-steel sm:col-span-2">{t("cargo.description")}<Input className="mt-1 h-10" value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} required /></label>
            <label className="text-xs text-steel">{t("cargo.category")}<NativeSelect className="mt-1 h-10 w-full field" value={it.category} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>{CATS.map((c) => <option key={c} value={c}>{t(`cargo.categories.${c}` as never)}</option>)}</NativeSelect></label>
            <label className="text-xs text-steel">{t("cargo.quantity")}<Input type="number" min={1} className="mt-1 h-10" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} /></label>
            <label className="text-xs text-steel">{t("cargo.value")} (GBP)<Input type="number" min={0} className="mt-1 h-10" value={it.value} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} /></label>
            <label className="text-xs text-steel">{t("cargo.purpose")}<NativeSelect className="mt-1 h-10 w-full field" value={it.purpose} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, purpose: e.target.value } : x)))}>{PURPOSES.map((c) => <option key={c} value={c}>{t(`cargo.purposes.${c}` as never)}</option>)}</NativeSelect></label>
            <label className="text-xs text-steel">{t("cargo.origin")}<NativeSelect className="mt-1 h-10 w-full field" value={it.originCountry} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, originCountry: e.target.value } : x)))}>{countryOptions(it.originCountry, locale)}</NativeSelect></label>
            <label className="text-xs text-steel">{t("cargo.hs")}{!freight && ` (${t("common.optional")})`}<Input className="mt-1 h-10" dir="ltr" value={it.hsCode} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, hsCode: e.target.value.replace(/\D/g, "") } : x)))} required={freight} /></label>
          </div>
        ))}
        <Button variant="outline" size="sm" className="rounded-xl border-navy-900 text-navy-900 mt-3" onClick={() => setItems([...items, { description: "", category: "OTHER", quantity: 1, value: 10, originCountry: "GB", hsCode: "", purpose: "GIFT" }])}><Plus className="size-4" />{t("cargo.addItem")}</Button>
        <p className="mt-3 text-sm text-steel">{money({ amountMinor: total, currency: "GBP" })}</p>
      </section>
      <section className="mt-6 grid gap-4 card-brand p-4 sm:grid-cols-3">
        <label className="text-sm">{t("cargo.readyDate")}<Input type="date" className="mt-1 h-10" value={readyDate} onChange={(e) => setReadyDate(e.target.value)} /></label>
        <label className="text-sm">{t("cargo.handover")}<NativeSelect className="mt-1 h-10 w-full field" value={handover} onChange={(e) => setHandover(e.target.value)}><option value="PICKUP">{t("cargo.pickup")}</option><option value="DROP_OFF">{t("cargo.dropOff")}</option></NativeSelect></label>
        {freight && <label className="text-sm">{t("cargo.incoterm")}<NativeSelect className="mt-1 h-10 w-full field" value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>{["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP"].map((x) => <option key={x}>{x}</option>)}</NativeSelect></label>}
        <fieldset className="grid gap-2 text-sm sm:col-span-3 sm:grid-cols-3"><legend className="mb-1 font-semibold">{t("cargo.declarations")}</legend>
          {(["batteries", "liquids", "medicines", "magnets", "dangerousGoods", "insuranceRequested"] as const).map((k) => <label key={k} className="flex items-center gap-2 pointer-coarse:min-h-11"><input type="checkbox" className="size-4 accent-orange" checked={decl[k]} onChange={(e) => setDecl({ ...decl, [k]: e.target.checked })} />{t(`cargo.${k === "dangerousGoods" ? "dg" : k === "insuranceRequested" ? "insurance" : k}` as never)}</label>)}
        </fieldset>
        {decl.dangerousGoods && <p role="alert" className="rounded-xl border-s-4 border-danger bg-danger-subtle px-4 py-3 text-sm text-danger sm:col-span-3">{t("flow.dgWarn")}</p>}
        <div className="sm:col-span-3"><p className="text-sm font-semibold">{t("cargo.documents")}</p>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 field py-2 text-sm"><Upload className="size-4" />{t("cargo.upload")}
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setDocs([...docs, await uploadFile(f, "OTHER")]) }} /></label>
          <ul className="mt-2 text-sm text-steel">{docs.map((d) => <li key={d.documentId}>{d.filename}</li>)}</ul>
        </div>
      </section>
      <section className="card-brand mt-6 space-y-2 p-5 text-sm">
        {(["accuracy", "prohibitedItems", "privacy"] as const).map((k) => <label key={k} className="flex items-start gap-3 pointer-coarse:min-h-11"><input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={consent[k]} onChange={(e) => setConsent({ ...consent, [k]: e.target.checked })} />{t(`cargo.consent${k === "accuracy" ? "Accuracy" : k === "prohibitedItems" ? "Prohibited" : "Privacy"}`)}</label>)}
      </section>
      {err && <p role="alert" className="mt-4 rounded-xl bg-danger-subtle px-4 py-3 text-sm text-danger">{err.problem.detail ?? err.problem.title}{err.problem.errors?.map((x) => <span key={x.path} className="block">{x.path}: {x.message}</span>)}</p>}
      <button type="button" className="btn-orange mt-6 h-13 w-full text-base" disabled={busy || !laneId || !phone || !consent.accuracy || !consent.prohibitedItems || !consent.privacy} onClick={() => void submit()}>{t("cargo.submit")}</button>
    </div>
  )
}
