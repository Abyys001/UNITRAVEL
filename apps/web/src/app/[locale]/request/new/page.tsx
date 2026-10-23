"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import type { Itinerary, Money, SearchQuery, TravellerView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Textarea } from "@unitravel/ui/components/textarea"

import { Ltr } from "@/components/badges"
import { ItineraryView } from "@/components/itinerary-view"
import { type SearchParamsShape, toQuery } from "@/components/search-form"
import { TravellerForm } from "@/components/traveller-form"
import { api, ApiError, newIdempotencyKey } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const SSR = ["WCHR", "WCHS", "WCHC", "VGML", "MOML", "CHML", "DBML", "PETC", "EXST", "UMNR"] as const

function RequestForm() {
  const { t, href, money, locale, sep } = useI18n()
  const { me, loading } = useSession()
  const router = useRouter()
  const sp = useSearchParams()
  const qc = useQueryClient()
  const searchId = sp.get("s")
  const itineraryId = sp.get("i")
  const manual = useMemo(() => { try { const m = sp.get("manual"); return m ? (JSON.parse(decodeURIComponent(escape(atob(m)))) as SearchParamsShape) : null } catch { return null } }, [sp])
  const kind = itineraryId ? "ITINERARY" : "MANUAL"
  const itn = useQuery({ queryKey: ["itn", itineraryId], queryFn: () => api<{ itinerary: Itinerary; query: SearchQuery }>(`/v1/itineraries/${itineraryId}`), enabled: !!itineraryId })
  const travellers = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: !!me })
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [contact, setContact] = useState("")
  const [form, setForm] = useState({ seat: sp.get("seat") ? "NONE" : "NONE", bestTime: "", note: "", flexibility: "", budget: "", avoid: "", prefer: "", overland: true, altName: "", altPhone: "", altRel: "" })
  const [ssr, setSsr] = useState<Record<string, string>>({})
  const [ack, setAck] = useState({ booking: false, privacy: false, self: false })
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [priceChange, setPriceChange] = useState<Money | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [key] = useState(newIdempotencyKey)
  useEffect(() => { if (!loading && !me) router.replace(href(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`)) }, [loading, me, router, href])
  const phones = me?.identities.filter((i) => i.type === "PHONE") ?? []
  useEffect(() => { if (!contact && phones[0]) setContact((phones.find((p) => p.isPrimary) ?? phones[0])!.id) }, [phones, contact])
  const it = itn.data?.itinerary
  const separate = it?.ticketing === "SEPARATE_TICKETS"
  const selected = Object.entries(chosen)
  const contactVerified = phones.find((p) => p.id === contact)?.verifiedAt

  const submit = async (acceptPriceChange = false) => {
    setBusy(true); setErr(null)
    const query = kind === "MANUAL" && manual ? toQuery(manual) : undefined
    const body = {
      kind, searchId: searchId ?? undefined, itineraryId: itineraryId ?? undefined, query, contactIdentityId: contact,
      travellers: selected.map(([travellerId, passengerType]) => ({ travellerId, passengerType })),
      manual: kind === "MANUAL" ? { flexibility: form.flexibility || undefined, budget: form.budget ? { amountMinor: Math.round(Number(form.budget) * 100), currency: "GBP" } : undefined, airlinesAvoid: form.avoid.split(/[ ,]+/).filter((x) => /^[A-Z0-9]{2}$/.test(x)), airlinesPrefer: form.prefer.split(/[ ,]+/).filter((x) => /^[A-Z0-9]{2}$/.test(x)), overlandAcceptable: form.overland } : undefined,
      alternativeContact: form.altName && form.altPhone ? { name: form.altName, phone: form.altPhone, relationship: form.altRel || "family" } : undefined,
      seatPreference: form.seat, seatChoice: sp.get("seat") && it ? [{ segmentRef: "0", designator: sp.get("seat")! }] : undefined,
      ssrs: Object.entries(ssr).filter(([, c]) => c).map(([travellerId, code]) => ({ travellerId, code })),
      bestTimeToCall: form.bestTime || undefined, note: form.note || undefined,
      acknowledgements: { notABooking: ack.booking, privacy: ack.privacy, selfTransfer: separate ? ack.self : undefined }, acceptPriceChange,
    }
    try {
      const r = await api<{ ref: string }>("/v1/flight-requests", { body, headers: { "idempotency-key": acceptPriceChange ? newIdempotencyKey() : key } })
      setDone(r.ref)
      await qc.invalidateQueries({ queryKey: ["requests"] })
    } catch (e) {
      const x = e as ApiError
      if (x.code === "PRICE_CHANGED") setPriceChange(x.problem.currentTotal as Money)
      else setErr(x)
    } finally { setBusy(false) }
  }

  if (done) return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <CheckCircle2 className="mx-auto size-12 text-moss" />
      <h1 className="font-display mt-4 text-3xl">{t("request.sentTitle")}</h1>
      <p className="mt-3 font-mono text-2xl tracking-wider" dir="ltr">{done}</p>
      <p className="mt-4 text-slate">{t("request.sentBody", { ref: done })}</p>
      <Link href={href(`/requests/${done}`)} className="mt-6 inline-block rounded-md bg-primary px-5 py-2.5 text-primary-foreground">{t("nav.requests")}</Link>
    </div>
  )
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-3xl">{kind === "ITINERARY" ? t("request.title") : t("request.manualTitle")}</h1>
      {it && <div className="mt-5"><ItineraryView it={it} /></div>}
      {manual && <p className="mt-3 text-slate"><Ltr>{manual.from.code} → {manual.to.code}</Ltr>{sep}{manual.date}</p>}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t("request.travellers")}</h2>
        <ul className="mt-3 space-y-2">
          {travellers.data?.map((tr) => (
            <li key={tr.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-white px-3 py-2">
              <label className="flex items-center gap-3"><input type="checkbox" className="size-4 accent-copper" checked={!!chosen[tr.id]} onChange={(e) => setChosen((c) => { const n = { ...c }; if (e.target.checked) n[tr.id] = "ADT"; else delete n[tr.id]; return n })} />
                <span dir="ltr">{tr.title} {tr.givenNames} {tr.surname}</span>{tr.nameFa && <span className="text-slate">{sep}{tr.nameFa}</span>}</label>
              {chosen[tr.id] && (
                <span className="flex gap-2">
                  <select aria-label="Passenger type" value={chosen[tr.id]} onChange={(e) => setChosen((c) => ({ ...c, [tr.id]: e.target.value }))} className="rounded border border-border bg-white px-2 py-1 text-sm"><option value="ADT">{t("search.adults")}</option><option value="CHD">{t("search.children")}</option><option value="INF">{t("search.infants")}</option><option value="STU">STU</option></select>
                  <select aria-label={t("request.ssr")} value={ssr[tr.id] ?? ""} onChange={(e) => setSsr((s) => ({ ...s, [tr.id]: e.target.value }))} className="rounded border border-border bg-white px-2 py-1 text-sm"><option value="">{t("request.ssr")}</option>{SSR.map((c) => <option key={c}>{c}</option>)}</select>
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-slate">{t("request.ssrHint")}</p>
        {adding ? <div className="mt-3"><TravellerForm onSaved={(tr) => { setAdding(false); setChosen((c) => ({ ...c, [tr.id]: "ADT" })); void travellers.refetch() }} /></div> : <Button variant="outline" className="mt-3" onClick={() => setAdding(true)}>{t("request.addTraveller")}</Button>}
      </section>
      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">{t("request.contact")}
          <select value={contact} onChange={(e) => setContact(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2" dir="ltr">{phones.map((p) => <option key={p.id} value={p.id}>{p.value} {p.verifiedAt ? "✓" : ""}</option>)}</select>
          {!contactVerified && <span className="mt-1 block text-xs text-brick">{t("request.verifyFirst")}</span>}
        </label>
        <label className="text-sm font-medium">{t("request.seat")}
          <select value={form.seat} onChange={(e) => setForm({ ...form, seat: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2">
            {(["NONE", "WINDOW", "AISLE", "TOGETHER", "EXTRA_LEGROOM"] as const).map((k) => <option key={k} value={k}>{t(`request.${({ NONE: "seatNone", WINDOW: "seatWindow", AISLE: "seatAisle", TOGETHER: "seatTogether", EXTRA_LEGROOM: "seatLegroom" } as const)[k]}`)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">{t("request.bestTime")}<input className="mt-1 h-10 w-full rounded-md border border-border px-3" value={form.bestTime} onChange={(e) => setForm({ ...form, bestTime: e.target.value })} placeholder="10:00–14:00" /></label>
        {kind === "MANUAL" && <label className="text-sm font-medium">{t("request.budget")}<input type="number" min={0} className="mt-1 h-10 w-full rounded-md border border-border px-3" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="GBP" /></label>}
        {kind === "MANUAL" && <label className="text-sm font-medium sm:col-span-2">{t("request.flexibility")}<input className="mt-1 h-10 w-full rounded-md border border-border px-3" value={form.flexibility} onChange={(e) => setForm({ ...form, flexibility: e.target.value })} /></label>}
        {kind === "MANUAL" && <label className="text-sm font-medium">{t("request.avoid")}<input dir="ltr" className="mt-1 h-10 w-full rounded-md border border-border px-3" value={form.avoid} onChange={(e) => setForm({ ...form, avoid: e.target.value.toUpperCase() })} placeholder="XQ, W6" /></label>}
        {kind === "MANUAL" && <label className="text-sm font-medium">{t("request.prefer")}<input dir="ltr" className="mt-1 h-10 w-full rounded-md border border-border px-3" value={form.prefer} onChange={(e) => setForm({ ...form, prefer: e.target.value.toUpperCase() })} placeholder="TK, BA" /></label>}
        {kind === "MANUAL" && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-copper" checked={form.overland} onChange={(e) => setForm({ ...form, overland: e.target.checked })} />{t("request.overland")}</label>}
        <fieldset className="grid gap-2 sm:col-span-2 sm:grid-cols-3"><legend className="mb-1 text-sm font-medium">{t("request.altContact")}</legend>
          <input aria-label={t("cargo.name")} className="h-10 rounded-md border border-border px-3" value={form.altName} onChange={(e) => setForm({ ...form, altName: e.target.value })} placeholder={t("cargo.name")} />
          <input aria-label={t("cargo.phone")} dir="ltr" className="h-10 rounded-md border border-border px-3" value={form.altPhone} onChange={(e) => setForm({ ...form, altPhone: e.target.value })} placeholder="+98…" />
          <input aria-label={t("account.relationship")} className="h-10 rounded-md border border-border px-3" value={form.altRel} onChange={(e) => setForm({ ...form, altRel: e.target.value })} placeholder={t("account.relationship")} />
        </fieldset>
        <label className="text-sm font-medium sm:col-span-2">{t("request.note")}<Textarea className="mt-1" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
      </section>
      <section className="mt-8 space-y-3 rounded-lg border border-border bg-sand p-4 text-sm">
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 size-4 accent-copper" checked={ack.booking} onChange={(e) => setAck({ ...ack, booking: e.target.checked })} />{t("request.ackBooking")}</label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 size-4 accent-copper" checked={ack.privacy} onChange={(e) => setAck({ ...ack, privacy: e.target.checked })} /><span>{t("request.ackPrivacy")} <Link className="underline" href={href("/privacy")}>{t("footer.privacy")}</Link></span></label>
        {separate && <label className="flex items-start gap-3 font-medium text-brick"><input type="checkbox" className="mt-0.5 size-4 accent-copper" checked={ack.self} onChange={(e) => setAck({ ...ack, self: e.target.checked })} />{t("request.ackSelfTransfer")}</label>}
      </section>
      {priceChange && (
        <div role="alertdialog" className="mt-4 rounded-md border border-copper bg-accent p-4 text-sm">
          <p>{t("request.priceChanged", { new: money(priceChange) })}</p>
          <Button className="mt-3" onClick={() => void submit(true)}>{t("request.confirmNew", { new: money(priceChange) })}</Button>
        </div>
      )}
      {err && <p role="alert" className="mt-4 rounded-md bg-[#fbeee9] px-3 py-2 text-sm text-brick">{err.problem.detail ?? err.problem.title}{err.problem.errors?.map((x) => <span key={x.path} className="block">{x.path}: {x.message}</span>)}</p>}
      <Button size="lg" className="mt-6 h-12 w-full" disabled={busy || !selected.length || !ack.booking || !ack.privacy || (separate && !ack.self) || !contactVerified} onClick={() => void submit()}>{t("request.submit")}</Button>
      <p className="mt-2 text-center text-xs text-slate" lang={locale}>{t("itinerary.requestNote")}</p>
    </div>
  )
}

export default function NewRequestPage() {
  return <Suspense><RequestForm /></Suspense>
}
