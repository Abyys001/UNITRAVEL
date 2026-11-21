"use client"

import { useQuery } from "@tanstack/react-query"
import { Plus, Search, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState } from "@/components/bento"
import { Field, PageHead, Panel } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Lane { id: string; originCountry: string; destinationCountry: string; label: string; enabled: boolean; services: string[]; volumetricDivisor: number }
interface Match { userId: string; displayName: string; email: string | null; phone: string | null; phoneVerified: boolean; cargoRequests: number; lastRef: string | null }
const CATS = ["DOCUMENTS", "CLOTHING", "PERSONAL_EFFECTS", "BOOKS", "FOOD_NON_PERISHABLE", "COSMETICS", "MEDICINES", "MEDICAL_DEVICES", "ELECTRONICS", "LITHIUM_BATTERIES", "AIRCRAFT_VEHICLE_INDUSTRIAL_PARTS", "JEWELLERY_ART", "OTHER"]
const PURPOSES = ["PERSONAL_EFFECTS", "GIFT", "DOCUMENTS", "SALE", "SAMPLE", "RETURN"]
const party = (country: string) => ({ name: "", company: "", line1: "", city: "", postcode: "", country, phone: "", email: "" })
type Party = ReturnType<typeof party>
const human = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ")

function PartyFields({ title, v, set }: { title: string; v: Party; set: (p: Party) => void }) {
  const t = useT()
  const inp = (k: keyof Party, label: string, opts: { req?: boolean; ltr?: boolean; type?: string } = {}) => (
    <Field label={label}><input type={opts.type ?? "text"} className="field-input" dir={opts.ltr ? "ltr" : "auto"} value={v[k]} onChange={(e) => set({ ...v, [k]: e.target.value })} required={opts.req} /></Field>
  )
  return (
    <Panel title={title}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {inp("name", t("new.name"), { req: true })}{inp("company", t("new.company"))}{inp("line1", t("ops.edit.line1"), { req: true })}{inp("city", t("ops.edit.city"), { req: true })}
        {inp("postcode", t("ops.edit.postcode"), { ltr: true })}{inp("phone", t("ops.edit.phone"), { req: true, ltr: true, type: "tel" })}{inp("email", t("ops.edit.email"), { ltr: true, type: "email" })}
      </div>
    </Panel>
  )
}

/** ADR-0042 D13: staff create a cargo request for a customer (phone, walk-in, email); screened like any other. */
export default function NewCargoRequest() {
  const t = useT()
  const router = useRouter()
  const { can } = useSession()
  const lanes = useQuery({ queryKey: ["lanes"], queryFn: () => api<Lane[]>("/v1/cargo/lanes") })
  const [lookup, setLookup] = useState("")
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [customer, setCustomer] = useState<Match | null>(null)
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "" })
  const [mode, setMode] = useState<"find" | "new">("find")
  const [laneId, setLaneId] = useState("")
  const [service, setService] = useState("PARCEL")
  const [shipper, setShipper] = useState(party("GB"))
  const [consignee, setConsignee] = useState(party("TR"))
  const [pieces, setPieces] = useState([{ lengthCm: 30, widthCm: 20, heightCm: 20, weightKg: 5 }])
  const [items, setItems] = useState([{ description: "", category: "CLOTHING", quantity: 1, value: 50, purpose: "PERSONAL_EFFECTS", hsCode: "" }])
  const [readyDate, setReadyDate] = useState(new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10))
  const [preferred, setPreferred] = useState("")
  const [handover, setHandover] = useState("PICKUP")
  const [handling, setHandling] = useState("")
  const [decl, setDecl] = useState({ batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false })
  const [channel, setChannel] = useState("PHONE")
  const [note, setNote] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const lane = lanes.data?.find((l) => l.id === laneId)
  const weight = useMemo(() => Math.round(pieces.reduce((n, p) => n + p.weightKg, 0) * 100) / 100, [pieces])
  const total = items.reduce((n, i) => n + Math.round(i.value * 100) * i.quantity, 0)
  if (!can("cargo_request.create.any")) return <div className="p-6"><EmptyState title={t("new.noAccess")} /></div>

  const find = async () => {
    setErr(null)
    try { const r = await api<Match[]>(`/v1/admin/cargo/customers?q=${encodeURIComponent(lookup.trim())}`); setMatches(r); if (r.length === 1) pick(r[0]!) } catch (e) { setErr(errText(e)) }
  }
  const pick = (m: Match) => { setCustomer(m); setShipper((s) => ({ ...s, name: s.name || m.displayName, phone: s.phone || m.phone || "", email: s.email || m.email || "" })) }
  const p = (x: Party) => ({ name: x.name, company: x.company || undefined, address: { line1: x.line1, city: x.city, postcode: x.postcode || undefined, country: x.country }, phone: x.phone, email: x.email || undefined })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (mode === "find" && !customer) return setErr(t("new.pickCustomer"))
    setBusy(true)
    try {
      const r = await api<{ ref: string }>("/v1/admin/cargo/requests", {
        headers: { "idempotency-key": crypto.randomUUID() },
        body: {
          customer: mode === "find" ? { userId: customer!.userId } : { name: newCustomer.name, email: newCustomer.email },
          service, laneId, shipper: p(shipper), consignee: p(consignee), readyDate, preferredDeliveryDate: preferred || undefined, handoverMode: handover, handlingInstructions: handling || undefined,
          pieces, items: items.map((i) => ({ description: i.description, category: i.category, quantity: i.quantity, unitValue: { amountMinor: Math.round(i.value * 100), currency: "GBP" }, originCountry: shipper.country, hsCode: i.hsCode || undefined, purpose: i.purpose })),
          declarations: decl, declaredTotal: { amountMinor: total, currency: "GBP" }, customerConfirmed: confirmed, channel, staffNote: note || undefined,
          commercial: service === "AIR_FREIGHT" ? { incoterm: "DAP" } : undefined,
        },
      })
      toast.success(t("new.created", { ref: r.ref }))
      router.push(`/cargo/${r.ref}`)
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }
  const num = "field-input num"
  return (
    <form onSubmit={submit} className="mx-auto max-w-5xl pb-16" data-testid="new-cargo">
      <PageHead title={t("new.title")} kicker={t("nav.cargo")} />
      <p className="px-4 pb-2 text-meta text-steel md:px-6">{t("new.intro")}</p>
      <div className="px-4 md:px-6">
        <Panel title={t("new.customer")}>
          <div className="mb-3 flex gap-2">{(["find", "new"] as const).map((m) => <Button key={m} type="button" size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>{t(m === "find" ? "new.existing" : "new.newCustomer")}</Button>)}</div>
          {mode === "find" ? (
            <>
              <div className="flex gap-2"><input className="field-input" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder={t("new.lookupHint")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find() } }} data-testid="customer-lookup" dir="ltr" /><Button type="button" variant="outline" onClick={() => void find()} disabled={lookup.trim().length < 3}><Search className="size-4" />{t("new.find")}</Button></div>
              {matches && !matches.length && <p className="mt-2 text-meta text-steel">{t("new.noMatch")}</p>}
              {customer && <p className="mt-2 rounded-md bg-success-subtle px-3 py-2 text-meta" data-testid="customer-picked"><b dir="auto">{customer.displayName}</b> · <span dir="ltr">{customer.email ?? customer.phone}</span> · {t("new.previous", { n: customer.cargoRequests })}</p>}
            </>
          ) : (
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label={t("new.name")}><input className="field-input" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} required minLength={2} dir="auto" /></Field>
              <Field label={t("ops.edit.email")} hint={t("new.emailHint")}><input type="email" className="field-input" dir="ltr" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} required /></Field>
            </div>
          )}
        </Panel>
        <Panel title={t("new.route")}>
          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label={t("new.lane")}><NativeSelect className="field-input" value={laneId} onChange={(e) => { setLaneId(e.target.value); const l = lanes.data?.find((x) => x.id === e.target.value); if (l) { setShipper((s) => ({ ...s, country: l.originCountry })); setConsignee((c) => ({ ...c, country: l.destinationCountry })) } }} required data-testid="new-lane"><option value="">—</option>{lanes.data?.filter((l) => l.enabled).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</NativeSelect></Field>
            <Field label={t("new.service")}><NativeSelect className="field-input" value={service} onChange={(e) => setService(e.target.value)}>{(lane?.services ?? ["DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE", "AIR_FREIGHT"]).map((s) => <option key={s} value={s}>{human(s)}</option>)}</NativeSelect></Field>
            <Field label={t("new.channel")}><NativeSelect className="field-input" value={channel} onChange={(e) => setChannel(e.target.value)}>{["PHONE", "IN_PERSON", "EMAIL", "OTHER"].map((c) => <option key={c} value={c}>{t(`new.ch.${c}` as never)}</option>)}</NativeSelect></Field>
          </div>
        </Panel>
      </div>
      <div className="grid gap-x-6 px-4 md:px-6 lg:grid-cols-2">
        <PartyFields title={t("new.sender")} v={shipper} set={setShipper} />
        <PartyFields title={t("new.recipient")} v={consignee} set={setConsignee} />
      </div>
      <div className="px-4 md:px-6">
        <Panel title={t("new.pieces", { kg: weight })}>
          {pieces.map((pc, i) => (
            <div key={i} className="mb-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
              {(["lengthCm", "widthCm", "heightCm", "weightKg"] as const).map((k) => <Field key={k} label={t(`new.${k}` as never)}><input type="number" min={0.1} step="0.1" className={num} value={pc[k]} onChange={(e) => setPieces(pieces.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)))} required /></Field>)}
              <Button type="button" variant="ghost" disabled={pieces.length === 1} onClick={() => setPieces(pieces.filter((_, j) => j !== i))} aria-label={t("agt.remove")}><Trash2 className="size-4" /></Button>
            </div>))}
          <Button type="button" size="sm" variant="outline" onClick={() => setPieces([...pieces, { lengthCm: 30, widthCm: 20, heightCm: 20, weightKg: 3 }])}><Plus className="size-4" />{t("new.addPiece")}</Button>
        </Panel>
        <Panel title={t("new.contents", { total: (total / 100).toFixed(2) })}>
          {items.map((it, i) => (
            <div key={i} className="mb-2 grid gap-2 sm:grid-cols-6">
              <Field label={t("new.description")} className="sm:col-span-2"><input className="field-input" value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} required minLength={2} dir="auto" /></Field>
              <Field label={t("new.category")}><NativeSelect className="field-input" value={it.category} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>{CATS.map((c) => <option key={c} value={c}>{human(c)}</option>)}</NativeSelect></Field>
              <Field label={t("new.quantity")}><input type="number" min={1} className={num} value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} /></Field>
              <Field label={t("new.value")}><input type="number" min={0} className={num} value={it.value} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} /></Field>
              <Field label={t("new.purpose")}><NativeSelect className="field-input" value={it.purpose} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, purpose: e.target.value } : x)))}>{PURPOSES.map((c) => <option key={c} value={c}>{human(c)}</option>)}</NativeSelect></Field>
            </div>))}
          <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, { description: "", category: "OTHER", quantity: 1, value: 10, purpose: "GIFT", hsCode: "" }])}><Plus className="size-4" />{t("new.addItem")}</Button>
        </Panel>
        <Panel title={t("new.handover")}>
          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label={t("ops.edit.ready")}><input type="date" className="field-input" value={readyDate} onChange={(e) => setReadyDate(e.target.value)} required /></Field>
            <Field label={t("ops.preferred")}><input type="date" className="field-input" min={readyDate} value={preferred} onChange={(e) => setPreferred(e.target.value)} /></Field>
            <Field label={t("new.handoverMode")}><NativeSelect className="field-input" value={handover} onChange={(e) => setHandover(e.target.value)}><option value="PICKUP">{t("new.pickup")}</option><option value="DROP_OFF">{t("new.dropOff")}</option></NativeSelect></Field>
          </div>
          <Field label={t("ops.handling")}><textarea className="field-input min-h-14" value={handling} onChange={(e) => setHandling(e.target.value)} maxLength={500} dir="auto" /></Field>
          <fieldset className="mt-2 grid gap-1 sm:grid-cols-3"><legend className="mb-1 text-meta font-medium">{t("new.declarations")}</legend>
            {(Object.keys(decl) as (keyof typeof decl)[]).map((k) => <label key={k} className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-orange" checked={decl[k]} onChange={(e) => setDecl({ ...decl, [k]: e.target.checked })} />{t(`new.d.${k}` as never)}</label>)}
          </fieldset>
          {decl.dangerousGoods && <p role="alert" className="mt-2 rounded-md bg-danger-subtle px-3 py-2 text-danger">{t("new.dgWarn")}</p>}
        </Panel>
        <Panel title={t("new.confirm")}>
          <Field label={t("new.staffNote")}><textarea className="field-input min-h-14" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} dir="auto" /></Field>
          <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required data-testid="customer-confirmed" /><span>{t("new.customerConfirmed")}</span></label>
          <p className="mt-2 text-caption text-steel">{t("new.screeningNote")}</p>
        </Panel>
        {err && <p role="alert" className="mb-3 rounded-md bg-danger-subtle px-3 py-2 text-danger">{err}</p>}
        <Button type="submit" className="h-12 w-full sm:w-auto" loading={busy} data-testid="new-submit">{t("new.submit")}</Button>
      </div>
    </form>
  )
}
