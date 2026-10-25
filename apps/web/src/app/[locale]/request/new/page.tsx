"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import type { CustomerItinerary, SearchQuery, TravellerView } from "@unitravel/contracts"
import { IconBadge } from "@unitravel/ui/brand/art"
import { Button } from "@unitravel/ui/components/button"
import { Textarea } from "@unitravel/ui/components/textarea"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { Auto, Ltr } from "@/components/badges"
import { ItineraryView } from "@/components/itinerary-view"
import { type SearchParamsShape, toQuery } from "@/components/search-form"
import { AddIdentity } from "@/components/add-identity"
import { TravellerForm } from "@/components/traveller-form"
import { api, ApiError, newIdempotencyKey } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const SSR_CODES = ["WCHR", "WCHS", "WCHC", "VGML", "MOML", "CHML", "DBML", "PETC", "EXST", "UMNR"] as const

type Mix = { a: number; c: number; i: number }
const ADULT_LIKE = ["ADT", "YTH", "STU"]
const mixOf = (types: string[]): Mix => ({ a: types.filter((x) => ADULT_LIKE.includes(x)).length, c: types.filter((x) => x === "CHD").length, i: types.filter((x) => x === "INF" || x === "INS").length })
const sameMix = (x: Mix, y: Mix) => x.a === y.a && x.c === y.c && x.i === y.i

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
  const itn = useQuery({ queryKey: ["itn", itineraryId], queryFn: () => api<{ itinerary: CustomerItinerary; query: SearchQuery }>(`/v1/itineraries/${itineraryId}`), enabled: !!itineraryId })
  const travellers = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: !!me })
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [contact, setContact] = useState("")
  const [form, setForm] = useState({ seat: sp.get("seat") ? "NONE" : "NONE", bestTime: "", note: "", flexibility: "", budget: "", avoid: "", prefer: "", overland: true, altName: "", altPhone: "", altRel: "" })
  const [ssr, setSsr] = useState<Record<string, string>>({})
  const [ack, setAck] = useState({ booking: false, privacy: false, self: false })
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [key] = useState(newIdempotencyKey)
  useEffect(() => { if (!loading && !me) router.replace(href(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`)) }, [loading, me, router, href])
  const phones = me?.identities.filter((i) => i.type === "PHONE") ?? []
  useEffect(() => { if (!contact && phones[0]) setContact((phones.find((p) => p.isPrimary) ?? phones[0])!.id) }, [phones, contact])
  const [preselected, setPreselected] = useState(false)
  useEffect(() => {
    if (preselected || !travellers.data || (!itn.data && itineraryId)) return
    setPreselected(true)
    const self = travellers.data.find((x) => x.relationship === "SELF")
    if (self) setChosen((c) => (Object.keys(c).length ? c : { [self.id]: "ADT" }))
  }, [preselected, travellers.data, itn.data, itineraryId])
  const it = itn.data?.itinerary
  const separate = it?.ticketing === "SEPARATE_TICKETS"
  const selected = Object.entries(chosen)
  // Priced and available for the searched group only: the selection must match its mix.
  const searched: Mix | null = itn.data ? mixOf(itn.data.query.passengers.map((p) => p.type)) : manual ? { a: manual.adt, c: manual.chd.length, i: manual.inf } : null
  const picked = mixOf(selected.map(([, type]) => type))
  const mixOk = !searched || sameMix(searched, picked)
  const full = !!searched && selected.length >= searched.a + searched.c + searched.i
  const mixText = (m: Mix) => t("flow.mixSearched", { a: m.a, c: m.c, i: m.i })
  // First type the searched group still needs, so a new pick defaults to a type that fits.
  const nextType = () => (!searched ? "ADT" : picked.a < searched.a ? "ADT" : picked.c < searched.c ? "CHD" : picked.i < searched.i ? "INF" : "ADT")
  const contactVerified = phones.find((p) => p.id === contact)?.verifiedAt

  const submit = async () => {
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
      acknowledgements: { notABooking: ack.booking, privacy: ack.privacy, selfTransfer: separate ? ack.self : undefined },
    }
    try {
      const r = await api<{ ref: string }>("/v1/flight-requests", { body, headers: { "idempotency-key": key } })
      await qc.invalidateQueries({ queryKey: ["requests"] })
      // Replace, not push: a reload or Back on the form must not be able to send the request twice.
      try { sessionStorage.setItem(`sent:${r.ref}`, "1") } catch { /* private mode: the request page still shows the request */ }
      setDone(r.ref)
      router.replace(href(`/requests/${r.ref}`))
    } catch (e) {
      setErr(e as ApiError)
    } finally { setBusy(false) }
  }

  if (done) return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="card-brand p-8 text-center">
        <IconBadge className="mx-auto border-success text-success"><CheckCircle2 /></IconBadge>
        <h1 className="font-display mt-5 text-3xl md:text-4xl">{t("request.sentTitle")}</h1>
        <p className="mt-4 inline-block rounded-xl bg-cloud px-4 py-2 font-mono text-2xl tracking-wider" dir="ltr">{done}</p>
        <p className="mt-4 text-steel">{t("request.sentBody", { ref: done })}</p>
        <Link href={href(`/requests/${done}`)} className="btn-orange mt-6">{t("nav.requests")}</Link>
      </div>
    </div>
  )
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{kind === "ITINERARY" ? t("request.title") : t("request.manualTitle")}</h1>
      {it && <div className="mt-5"><ItineraryView it={it} /></div>}
      {manual && <p className="mt-3 text-steel"><Ltr>{manual.from.code} → {manual.to.code}</Ltr>{sep}{manual.date}</p>}
      <section className="card-brand mt-6 p-5">
        <h2 className="font-display text-xl">{t("request.travellers")}</h2>
        <ul className="mt-3 space-y-2">
          {travellers.data?.map((tr) => (
            <li key={tr.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-cloud px-3 py-2.5">
              <label className="flex items-center gap-3"><input type="checkbox" className="size-4 accent-orange pointer-coarse:size-5" checked={!!chosen[tr.id]} disabled={!chosen[tr.id] && full} onChange={(e) => setChosen((c) => { const n = { ...c }; if (e.target.checked) n[tr.id] = nextType(); else delete n[tr.id]; return n })} />
                <span dir="ltr">{t(`honorifics.${tr.title}` as never)} {tr.givenNames} {tr.surname}</span>{tr.nameFa && <span className="text-steel">{sep}<Auto>{tr.nameFa}</Auto></span>}</label>
              {chosen[tr.id] && (
                <span className="flex gap-2">
                  <NativeSelect aria-label={t("flow.ticketType")} value={chosen[tr.id]} onChange={(e) => setChosen((c) => ({ ...c, [tr.id]: e.target.value }))} className="field py-1 text-sm">{(["ADT", "CHD", "INF"] as const).map((k) => <option key={k} value={k}>{t(`paxType.${k}`)}</option>)}</NativeSelect>
                  <NativeSelect aria-label={t("request.ssr")} value={ssr[tr.id] ?? ""} onChange={(e) => setSsr((s) => ({ ...s, [tr.id]: e.target.value }))} className="field py-1 text-sm"><option value="">{t("request.ssr")}</option>{SSR_CODES.map((c) => <option key={c} value={c}>{t(`ssrCodes.${c}` as never)}</option>)}</NativeSelect>
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-steel">{t("request.ssrHint")}</p>
        {searched && !mixOk && selected.length > 0 && (
          <p role="alert" data-testid="mix-mismatch" className="mt-3 rounded-xl bg-danger-subtle px-4 py-3 text-sm text-danger">{t("flow.mixMismatch", { searched: mixText(searched), selected: mixText(picked) })} <Link className="font-semibold underline" href={href("/")}>{t("flow.newSearch")}</Link></p>
        )}
        {adding ? <div className="mt-3"><TravellerForm onSaved={(tr) => { setAdding(false); if (!full) setChosen((c) => ({ ...c, [tr.id]: nextType() })); void travellers.refetch() }} /></div> : <Button variant="outline" className="rounded-xl border-navy-900 text-navy-900 mt-3" onClick={() => setAdding(true)}>{t("request.addTraveller")}</Button>}
      </section>
      <section className="card-brand mt-6 grid gap-4 p-5 sm:grid-cols-2">
        <label className="text-sm font-medium">{t("request.contact")}
          <NativeSelect value={contact} onChange={(e) => setContact(e.target.value)} className="mt-1 h-10 w-full field" dir="ltr">{phones.map((p) => <option key={p.id} value={p.id}>{p.value} {p.verifiedAt ? "✓" : ""}</option>)}</NativeSelect>
          {!contactVerified && <span className="mt-1 block text-xs text-danger">{t("request.verifyFirst")}</span>}
        </label>
        {!contactVerified && <div className="sm:col-span-2" data-testid="inline-verify-phone"><p className="mb-2 text-sm font-medium">{t("identity.verifyInline")}</p><AddIdentity channels={["PHONE"]} onDone={() => setContact("")} /></div>}
        <label className="text-sm font-medium">{t("request.seat")}
          <NativeSelect value={form.seat} onChange={(e) => setForm({ ...form, seat: e.target.value })} className="mt-1 h-10 w-full field">
            {(["NONE", "WINDOW", "AISLE", "TOGETHER", "EXTRA_LEGROOM"] as const).map((k) => <option key={k} value={k}>{t(`request.${({ NONE: "seatNone", WINDOW: "seatWindow", AISLE: "seatAisle", TOGETHER: "seatTogether", EXTRA_LEGROOM: "seatLegroom" } as const)[k]}`)}</option>)}
          </NativeSelect>
        </label>
        <label className="text-sm font-medium">{t("request.bestTime")}<input className="mt-1 h-10 w-full field" value={form.bestTime} onChange={(e) => setForm({ ...form, bestTime: e.target.value })} placeholder="10:00–14:00" /></label>
        {kind === "MANUAL" && <label className="text-sm font-medium">{t("request.budget")}<input type="number" min={0} className="mt-1 h-10 w-full field" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="GBP" /></label>}
        {kind === "MANUAL" && <label className="text-sm font-medium sm:col-span-2">{t("request.flexibility")}<input className="mt-1 h-10 w-full field" value={form.flexibility} onChange={(e) => setForm({ ...form, flexibility: e.target.value })} /></label>}
        {kind === "MANUAL" && <label className="text-sm font-medium">{t("request.avoid")}<input dir="ltr" className="mt-1 h-10 w-full field" value={form.avoid} onChange={(e) => setForm({ ...form, avoid: e.target.value.toUpperCase() })} placeholder="XQ, W6" /></label>}
        {kind === "MANUAL" && <label className="text-sm font-medium">{t("request.prefer")}<input dir="ltr" className="mt-1 h-10 w-full field" value={form.prefer} onChange={(e) => setForm({ ...form, prefer: e.target.value.toUpperCase() })} placeholder="TK, BA" /></label>}
        {kind === "MANUAL" && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-orange" checked={form.overland} onChange={(e) => setForm({ ...form, overland: e.target.checked })} />{t("request.overland")}</label>}
        <fieldset className="grid gap-2 sm:col-span-2 sm:grid-cols-3"><legend className="mb-1 text-sm font-medium">{t("request.altContact")}</legend>
          <input aria-label={t("cargo.name")} className="h-10 field" value={form.altName} onChange={(e) => setForm({ ...form, altName: e.target.value })} placeholder={t("cargo.name")} />
          <input aria-label={t("cargo.phone")} dir="ltr" className="h-10 field" value={form.altPhone} onChange={(e) => setForm({ ...form, altPhone: e.target.value })} placeholder="+98…" />
          <input aria-label={t("account.relationship")} className="h-10 field" value={form.altRel} onChange={(e) => setForm({ ...form, altRel: e.target.value })} placeholder={t("account.relationship")} />
        </fieldset>
        <label className="text-sm font-medium sm:col-span-2">{t("request.note")}<Textarea className="mt-1" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
      </section>
      <section data-ack className="card-brand mt-6 space-y-3 p-5 text-sm">
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={ack.booking} onChange={(e) => setAck({ ...ack, booking: e.target.checked })} />{t("request.ackBooking")}</label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={ack.privacy} onChange={(e) => setAck({ ...ack, privacy: e.target.checked })} /><span>{t("request.ackPrivacy")} <Link className="underline" href={href("/privacy")}>{t("footer.privacy")}</Link></span></label>
        {separate && <label className="flex items-start gap-3 font-medium text-danger"><input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={ack.self} onChange={(e) => setAck({ ...ack, self: e.target.checked })} />{t("request.ackSelfTransfer")}</label>}
      </section>
      {err && <p role="alert" className="mt-4 rounded-xl bg-danger-subtle px-4 py-3 text-sm text-danger">{err.problem.detail ?? err.problem.title}{err.problem.errors?.map((x) => <span key={x.path} className="block">{x.path}: {x.message}</span>)}</p>}
      <button type="button" className="btn-orange mt-6 h-13 w-full text-base" disabled={busy || !selected.length || !mixOk || !ack.booking || !ack.privacy || (separate && !ack.self) || !contactVerified} onClick={() => void submit()}>{t("request.submit")}</button>
      <p className="mt-2 text-center text-xs text-steel" lang={locale}>{t("itinerary.requestNote")}</p>
    </div>
  )
}

export default function NewRequestPage() {
  return <Suspense><RequestForm /></Suspense>
}
