"use client"

import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, Globe2, Info, Loader2, Plus, RefreshCw, ShieldAlert, Trash2, XCircle } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"

import {
  TRANSIT_MODES, TRAVEL_PURPOSES, type TravelDocumentTypeView, type VisaCheckBody, type VisaCheckView, type VisaColour, type VisaFacts, type VisaLegResult,
} from "@unitravel/contracts"
import { CountrySelect } from "@unitravel/ui/product/country"
import { LoadingState } from "@unitravel/ui/product/states"

import { Auto, Ltr } from "@/components/badges"
import { Field, inDays, inputCls, ServiceFormFrame, today, Unavailable } from "@/components/service-form"
import { api, ApiError } from "@/lib/api"
import { COUNTRIES, countryName, sortedCountries } from "@/lib/countries"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { useSite } from "@/lib/site"

// ADR-0029: the checker sits on top of the existing VISA service request (ADR-0015, O6), which stays usable on its own.
// Nothing here decides anything: the page shows what the API confirmed, with its sources, and "not confirmed" otherwise.

type TransitMode = (typeof TRANSIT_MODES)[number]
type TravelPurpose = (typeof TRAVEL_PURPOSES)[number]
const REQUEST_PURPOSES = ["TOURISM", "BUSINESS", "STUDY", "FAMILY", "TRANSIT"] as const
type RequestPurpose = (typeof REQUEST_PURPOSES)[number]
/** The request form has fewer purposes; the closest one is preselected and stays editable. */
const TO_REQUEST_PURPOSE: Record<TravelPurpose, RequestPurpose> = { TOURISM: "TOURISM", BUSINESS: "BUSINESS", FAMILY: "FAMILY", STUDY: "STUDY", MEDICAL: "TOURISM", TRANSIT: "TRANSIT", OTHER: "TOURISM" }

const POLL_MS = 3000
const POLL_LIMIT_MS = 180_000

const TONE: Record<VisaColour, string> = {
  GREEN: "border-success-border bg-success-subtle text-success-subtle-fg",
  BLUE: "border-info-border bg-info-subtle text-info-subtle-fg",
  ORANGE: "border-warning-border bg-warning-subtle text-warning-subtle-fg",
  RED: "border-danger bg-danger-subtle text-danger",
  GREY: "border-line bg-steel/10 text-steel",
}
const ICON: Record<VisaColour, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  GREEN: CheckCircle2, BLUE: Globe2, ORANGE: AlertTriangle, RED: XCircle, GREY: CircleHelp,
}

interface FormState {
  documentType: string
  issuingCountry: string
  nationality: string
  residenceCountry: string
  residencePermit: string
  destination: string
  transits: Array<{ country: string; mode: TransitMode }>
  departureDate: string
  returnDate: string
  purpose: TravelPurpose
}

const initialForm = (): FormState => ({
  documentType: "GB_CITIZEN_PASSPORT", issuingCountry: "GB", nationality: "", residenceCountry: "", residencePermit: "", destination: "TR", transits: [],
  departureDate: inDays(30), returnDate: inDays(40), purpose: "TOURISM",
})

function bodyOf(f: FormState, fresh: boolean): VisaCheckBody {
  return {
    documentType: f.documentType, issuingCountry: f.issuingCountry, nationality: f.nationality || null, residenceCountry: f.residenceCountry || null,
    residencePermit: f.residencePermit.trim() || null, destination: f.destination, transits: f.transits, departureDate: f.departureDate,
    returnDate: f.returnDate || null, purpose: f.purpose, fresh,
  }
}

/** Rebuilds the form from a stored check (after the sign-in round trip); the residence permit text is not kept by the API. */
function formOf(c: VisaCheckView): FormState {
  return {
    documentType: c.input.documentType, issuingCountry: c.input.issuingCountry, nationality: c.input.nationality ?? "", residenceCountry: c.input.residenceCountry ?? "",
    residencePermit: c.input.residencePermit ?? "", destination: c.input.destination, departureDate: c.input.departureDate, returnDate: c.input.returnDate ?? "", purpose: c.input.purpose,
    transits: c.legs.filter((l) => l.role === "TRANSIT").map((l) => ({ country: l.country, mode: l.transitMode ?? "AIRSIDE" })),
  }
}

export default function VisaPage() {
  return <Suspense><VisaPageInner /></Suspense>
}

function VisaPageInner() {
  const { t } = useI18n()
  const { site, loaded } = useSite()
  if (loaded && site.menu.visa !== true) return <Unavailable title={t("visaCheck.title")} />
  if (!loaded) return <div className="mx-auto max-w-3xl px-4 py-8"><LoadingState label={t("common.loading")} rows={3} /></div>
  return <VisaChecker />
}

function VisaChecker() {
  const { t, locale, href } = useI18n()
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const { me } = useSession()
  const [form, setForm] = useState<FormState>(initialForm)
  const [checkId, setCheckId] = useState<string | null>(params.get("check"))
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ApiError | null>(null)
  const resultRef = useRef<HTMLElement>(null)
  const restored = useRef(false)

  const docs = useQuery({ queryKey: ["visa-document-types"], queryFn: () => api<TravelDocumentTypeView[]>("/v1/visa/document-types"), staleTime: 300_000 })
  const doc = docs.data?.find((d) => d.code === form.documentType)
  const countries = useMemo(() => sortedCountries(locale), [locale])

  const check = useQuery({
    queryKey: ["visa-check", checkId],
    queryFn: () => api<VisaCheckView>(`/v1/visa/checks/${checkId}`),
    enabled: !!checkId,
    retry: false,
    refetchInterval: (q) => (q.state.data && !q.state.data.complete && Date.now() - startedAt < POLL_LIMIT_MS ? POLL_MS : false),
  })

  // After a sign-in round trip the check id comes back in the URL: put its trip back into the form once.
  useEffect(() => {
    if (!restored.current && check.data && params.get("check") === check.data.id) { restored.current = true; setForm(formOf(check.data)) }
  }, [check.data, params])

  const setDoc = (code: string) => {
    const d = docs.data?.find((x) => x.code === code)
    setForm((f) => ({ ...f, documentType: code, issuingCountry: d?.issuingCountry ?? (f.issuingCountry === "GB" ? "IR" : f.issuingCountry) }))
  }

  const run = async (fresh: boolean) => {
    if (fresh && !me) {
      router.push(href(`/sign-in?next=${encodeURIComponent(`${path}?check=${checkId ?? ""}`)}`))
      return
    }
    setBusy(true); setErr(null)
    try {
      const c = await api<VisaCheckView>("/v1/visa/checks", { body: bodyOf(form, fresh) })
      setStartedAt(Date.now())
      setCheckId(c.id)
      router.replace(`${path}?check=${c.id}`, { scroll: false })
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError({ status: 0, code: "INTERNAL", title: String(e) }))
    } finally {
      setBusy(false)
    }
  }

  const valid = !!form.documentType && !!form.issuingCountry && !!form.destination && !!form.departureDate && (!form.returnDate || form.returnDate >= form.departureDate)
    && !form.transits.some((x) => x.country === form.destination)
  const lockedIssuer = doc?.issuingCountry ?? null
  const result = check.data
  const timedOut = !!result && !result.complete && Date.now() - startedAt >= POLL_LIMIT_MS

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("visaCheck.title")}</h1>
      <p className="mt-3 max-w-2xl leading-7 text-steel">{t("visaCheck.lead")}</p>

      <form className="mt-6 max-w-3xl space-y-6" noValidate onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void run(false) }}>
        <fieldset className="card-brand grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 p-5 sm:grid-cols-2">
          <legend className="font-display px-1 text-lg">{t("visaCheck.formTitle")}</legend>
          <div className="sm:col-span-2">
            <Field id="vc-doc" label={t("visaCheck.document")}>
              {docs.isLoading ? <LoadingState label={t("common.loading")} rows={1} /> : (
                <select id="vc-doc" className={inputCls} value={form.documentType} onChange={(e) => setDoc(e.target.value)} aria-describedby="vc-doc-desc">
                  {docs.data?.map((d) => <option key={d.code} value={d.code}>{d.name[locale]}</option>)}
                </select>
              )}
            </Field>
            {doc && <p id="vc-doc-desc" className="mt-1.5 text-xs leading-5 text-steel">{doc.description[locale]}</p>}
          </div>
          <div>
            <Field id="vc-issuer" label={t("visaCheck.issuingCountry")}>
              <CountrySelect id="vc-issuer" className={inputCls} value={form.issuingCountry} disabled={!!lockedIssuer} aria-describedby={lockedIssuer ? "vc-issuer-note" : undefined}
                onChange={(e) => setForm({ ...form, issuingCountry: e.target.value })}>
                {(lockedIssuer ? [lockedIssuer] : countries).map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}
              </CountrySelect>
            </Field>
            {lockedIssuer && <p id="vc-issuer-note" className="mt-1.5 text-xs text-steel">{t("visaCheck.issuingLocked", { country: countryName(lockedIssuer, locale) })}</p>}
          </div>
          <div>
            <Field id="vc-nat" label={t("visaCheck.nationality")} optional>
              <select id="vc-nat" className={inputCls} value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} aria-describedby="vc-nat-hint">
                <option value="">{t("visaCheck.noNationality")}</option>
                {countries.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}
              </select>
            </Field>
            <p id="vc-nat-hint" className="mt-1.5 text-xs leading-5 text-steel">{t("visaCheck.nationalityHint")}</p>
          </div>
          <Field id="vc-res" label={t("visaCheck.residence")} optional>
            <select id="vc-res" className={inputCls} value={form.residenceCountry} onChange={(e) => setForm({ ...form, residenceCountry: e.target.value })}>
              <option value="">{t("visaCheck.residenceNone")}</option>
              {countries.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}
            </select>
          </Field>
          <div>
            <Field id="vc-permit" label={t("visaCheck.residencePermit")} optional>
              <input id="vc-permit" className={inputCls} dir="auto" maxLength={120} value={form.residencePermit} aria-describedby="vc-permit-hint" onChange={(e) => setForm({ ...form, residencePermit: e.target.value })} />
            </Field>
            <p id="vc-permit-hint" className="mt-1.5 text-xs leading-5 text-steel">{t("visaCheck.residencePermitHint")}</p>
          </div>
          <Field id="vc-dest" label={t("visaCheck.destination")}>
            <CountrySelect id="vc-dest" className={inputCls} value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}>
              {countries.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}
            </CountrySelect>
          </Field>
          <Field id="vc-purpose" label={t("visaCheck.purpose")}>
            <select id="vc-purpose" className={inputCls} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as TravelPurpose })}>
              {TRAVEL_PURPOSES.map((p) => <option key={p} value={p}>{t(`visaCheck.purposes.${p}`)}</option>)}
            </select>
          </Field>
          <Field id="vc-dep" label={t("visaCheck.departure")}>
            <input id="vc-dep" type="date" className={inputCls} min={today()} value={form.departureDate} required onChange={(e) => setForm({ ...form, departureDate: e.target.value })} />
          </Field>
          <Field id="vc-ret" label={t("visaCheck.returnDate")} optional>
            <input id="vc-ret" type="date" className={inputCls} min={form.departureDate || today()} value={form.returnDate} onChange={(e) => setForm({ ...form, returnDate: e.target.value })} />
          </Field>

          <div className="space-y-3 sm:col-span-2">
            <p className="text-sm font-medium">{t("visaCheck.transits")} <span className="text-steel">({t("common.optional")})</span></p>
            <p className="text-xs leading-5 text-steel">{t("visaCheck.transitsHint")}</p>
            {form.transits.map((x, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Field id={`vc-tr-${i}`} label={t("visaCheck.transitCountry", { n: i + 1 })}>
                  <CountrySelect id={`vc-tr-${i}`} className={inputCls} value={x.country}
                    onChange={(e) => setForm({ ...form, transits: form.transits.map((y, j) => (j === i ? { ...y, country: e.target.value } : y)) })}>
                    {countries.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}
                  </CountrySelect>
                </Field>
                <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <Field id={`vc-trm-${i}`} label={t("visaCheck.transitMode")}>
                    <select id={`vc-trm-${i}`} className={inputCls} value={x.mode}
                      onChange={(e) => setForm({ ...form, transits: form.transits.map((y, j) => (j === i ? { ...y, mode: e.target.value as TransitMode } : y)) })}>
                      {TRANSIT_MODES.map((m) => <option key={m} value={m}>{t(`visaCheck.modes.${m}`)}</option>)}
                    </select>
                  </Field>
                </div>
                <button type="button" className="col-start-2 row-start-1 grid size-10 place-items-center rounded-lg border border-line text-steel hover:text-danger sm:col-start-auto sm:row-start-auto"
                  aria-label={t("visaCheck.removeTransit", { n: i + 1 })} onClick={() => setForm({ ...form, transits: form.transits.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ))}
            {form.transits.length < 4 && (
              <button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-royal underline-offset-4 hover:underline pointer-coarse:min-h-11"
                onClick={() => setForm({ ...form, transits: [...form.transits, { country: form.destination === "AE" ? "QA" : "AE", mode: "AIRSIDE" }] })}>
                <Plus className="size-4" aria-hidden />{t("visaCheck.addTransit")}
              </button>
            )}
          </div>
        </fieldset>

        {err && (
          <div role="alert" className="rounded-xl border-s-4 border-danger bg-danger-subtle px-4 py-3 text-sm">
            <p className="font-semibold">{err.problem.code === "FEATURE_DISABLED" ? t("services.unavailableTitle") : err.message}</p>
            {err.problem.errors?.map((e) => <p key={e.path} dir="auto">{e.message ?? e.code}</p>)}
          </div>
        )}
        <button type="submit" className="btn-orange inline-flex items-center gap-2" disabled={!valid || busy} aria-disabled={!valid || busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{busy ? t("visaCheck.checking") : t("visaCheck.submit")}
        </button>
      </form>

      <section ref={resultRef} className="mt-10 scroll-mt-24" aria-live="polite" aria-busy={!!result && !result.complete}>
        {checkId && check.isLoading && <LoadingState label={t("visaCheck.checking")} rows={3} />}
        {result && (
          <Results result={result} documentName={result.input.documentName[locale]} timedOut={timedOut} onRefresh={() => { setStartedAt(Date.now()); void check.refetch() }}
            onFresh={() => void run(true)} signedIn={!!me} busy={busy} />
        )}
      </section>

      <Disclaimer />

      <section className="mt-12 border-t border-line pt-10">
        <VisaRequestForm key={result?.id ?? "none"} prefill={result ? { destination: result.input.destination, purpose: TO_REQUEST_PURPOSE[result.input.purpose], date: result.input.departureDate } : null} />
      </section>
    </div>
  )
}

function Results({ result, documentName, timedOut, onRefresh, onFresh, signedIn, busy }: {
  result: VisaCheckView; documentName: string; timedOut: boolean; onRefresh: () => void; onFresh: () => void; signedIn: boolean; busy: boolean
}) {
  const { t, locale } = useI18n()
  const Icon = ICON[result.overall]
  const days = result.input.returnDate ? Math.round((Date.parse(result.input.returnDate) - Date.parse(result.input.departureDate)) / 86400_000) + 1 : null
  return (
    <div className="space-y-5" data-testid="visa-result">
      <h2 className="font-display text-2xl md:text-3xl">{t("visaCheck.resultTitle")}</h2>
      <p className="text-sm text-steel">
        {t("visaCheck.tripSummary", { document: documentName, issuer: countryName(result.input.issuingCountry, locale) })}
        {days !== null && days > 0 && <> · {t("visaCheck.tripLength", { days })}</>}
      </p>
      {result.complete && (
        <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${TONE[result.overall]}`} data-colour={result.overall}>
          <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p className="font-semibold">{t(`visaCheck.overall.${result.overall}`)}</p>
        </div>
      )}
      {timedOut && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm">
          <p className="min-w-0 flex-1">{t("visaCheck.timeout")}</p>
          <button type="button" className="inline-flex items-center gap-2 font-semibold text-royal underline" onClick={onRefresh}><RefreshCw className="size-4" aria-hidden />{t("visaCheck.refresh")}</button>
        </div>
      )}
      <div className="grid gap-5">
        {result.legs.map((leg) => <LegCard key={`${leg.role}-${leg.country}`} leg={leg} documentName={documentName} issuer={result.input.issuingCountry} />)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-royal px-4 py-2 text-sm font-semibold text-royal disabled:opacity-50 pointer-coarse:min-h-11"
          onClick={onFresh} disabled={busy}>
          <RefreshCw className="size-4" aria-hidden />{signedIn ? t("visaCheck.fresh") : t("visaCheck.freshSignIn")}
        </button>
        <p className="text-xs text-steel">{t("visaCheck.freshNote")}</p>
        {result.freshLimited && <p role="status" className="w-full text-sm font-medium text-warning-subtle-fg">{t("visaCheck.freshLimited")}</p>}
      </div>
    </div>
  )
}

function LegCard({ leg, documentName, issuer }: { leg: VisaLegResult; documentName: string; issuer: string }) {
  const { t, locale, date } = useI18n()
  const Icon = ICON[leg.colour]
  const d = (iso: string) => date(iso, { dateOnly: true, year: true })
  return (
    <article className="card-brand min-w-0 space-y-4 p-5" data-testid="visa-leg" data-colour={leg.colour}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel">{t(`visaCheck.roles.${leg.role}`)}{leg.transitMode && <> · {t(`visaCheck.modes.${leg.transitMode}`)}</>}</p>
          <h3 className="font-display text-xl">{countryName(leg.country, locale)}</h3>
          <p className="text-xs text-steel">{documentName} · {countryName(issuer, locale)}</p>
        </div>
        {leg.state === "RESEARCHING" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm font-semibold text-steel"><Loader2 className="size-4 animate-spin" aria-hidden />{t("visaCheck.researching")}</span>
        ) : (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${TONE[leg.colour]}`}><Icon className="size-4" aria-hidden />{t(`visaCheck.statuses.${leg.facts.status}`)}</span>
        )}
      </header>

      {leg.state === "RESEARCHING" ? (
        <p className="text-sm text-steel">{t("visaCheck.researchingBody")}</p>
      ) : (
        <>
          {leg.state === "FAILED" && <p className="text-sm font-semibold text-danger">{t("visaCheck.failed")}</p>}
          {leg.colour === "GREY" && (
            <p className="flex items-start gap-2 rounded-xl border border-line bg-steel/5 px-4 py-3 text-sm font-semibold" data-testid="visa-unconfirmed">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{t("visaCheck.unconfirmed")}
            </p>
          )}
          <Facts facts={leg.facts} transit={leg.role === "TRANSIT"} />
          <p className="text-xs text-steel">
            {leg.verifiedAt ? t("visaCheck.verifiedAt", { date: d(leg.verifiedAt) }) : t("visaCheck.neverVerified")}
            {leg.stale && <> · <span className="font-semibold text-warning-subtle-fg">{t("visaCheck.stale")}</span></>}
          </p>
        </>
      )}

      {leg.notices.filter((n) => !(n === "STALE" && leg.stale)).length > 0 && (
        <ul className="space-y-2">
          {leg.notices.filter((n) => !(n === "STALE" && leg.stale)).map((n) => (
            <li key={n} className="flex items-start gap-2 text-sm leading-6"><Info className="mt-1 size-4 shrink-0 text-royal" aria-hidden />{t(`visaCheck.notices.${n}`)}</li>
          ))}
        </ul>
      )}

      <Sources leg={leg} />
    </article>
  )
}

function Facts({ facts, transit }: { facts: VisaFacts; transit: boolean }) {
  const { t } = useI18n()
  const nc = <span className="italic text-steel">{t("visaCheck.notConfirmed")}</span>
  const yn = (v: boolean | null) => (v === null ? nc : v ? t("visaCheck.yes") : t("visaCheck.no"))
  const txt = (v: string | null) => (v === null ? nc : <Auto>{v}</Auto>)
  const rows: Array<[string, React.ReactNode]> = [
    [t("visaCheck.documentAccepted"), yn(facts.documentAccepted)],
    [t("visaCheck.maxStay"), txt(facts.maxStay)],
    [t("visaCheck.entries"), facts.entries ? t(`visaCheck.entriesValues.${facts.entries}`) : nc],
    [t("visaCheck.passportValidity"), txt(facts.passportValidity)],
    [t("visaCheck.blankPages"), txt(facts.blankPages)],
    [t("visaCheck.applyOnline"), yn(facts.applyOnline)],
    [t("visaCheck.embassyAppointment"), yn(facts.embassyAppointment)],
    [t("visaCheck.fee"), txt(facts.fee)],
    [t("visaCheck.processingTime"), txt(facts.processingTime)],
    [t("visaCheck.applicationUrl"), facts.applicationUrl
      ? <a href={facts.applicationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-royal underline">{t("visaCheck.openApplication")}<ExternalLink className="size-3.5" aria-hidden /></a>
      : nc],
    ...(transit ? [[t("visaCheck.airsideTransit"), yn(facts.airsideTransitWithoutVisa)] as [string, React.ReactNode]] : []),
  ]
  return (
    <div>
      <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col border-b border-line/60 pb-2">
            <dt className="text-xs text-steel">{k}</dt>
            <dd className="break-words font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {facts.conditions.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="text-xs text-steel">{t("visaCheck.conditions")}</p>
          <ul className="mt-1 list-disc space-y-1 ps-5">{facts.conditions.map((c) => <li key={c}><Auto>{c}</Auto></li>)}</ul>
        </div>
      )}
    </div>
  )
}

function Sources({ leg }: { leg: VisaLegResult }) {
  const { t, date } = useI18n()
  const d = (iso: string) => date(iso, { dateOnly: true, year: true })
  const host = (u: string) => { try { return new URL(u).hostname } catch { return u } }
  return (
    <div className="space-y-3 border-t border-line pt-4 text-sm">
      <div>
        <h4 className="font-semibold">{t("visaCheck.sources")}</h4>
        {leg.sources.length === 0 ? <p className="mt-1 text-steel">{t("visaCheck.noSources")}</p> : (
          <ul className="mt-2 space-y-3">
            {leg.sources.map((s) => (
              <li key={s.url} className="min-w-0">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-semibold text-royal underline">
                  <Auto className="truncate">{s.title || host(s.url)}</Auto><ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-steel">
                  <span className={s.official ? "font-semibold text-success-subtle-fg" : "font-semibold text-warning-subtle-fg"}>{s.official ? t("visaCheck.official") : t("visaCheck.supporting")}</span>
                  <Ltr>{host(s.url)}</Ltr>
                  <span>{t("visaCheck.read", { date: d(s.fetchedAt) })}</span>
                  {s.sourceUpdatedAt && <span>{t("visaCheck.pageUpdated", { date: d(s.sourceUpdatedAt) })}</span>}
                </p>
                {s.quotes.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-steel">{t("visaCheck.quotes")}</summary>
                    <ul className="mt-1 space-y-1">{s.quotes.slice(0, 3).map((q) => <li key={q}><blockquote dir="ltr" lang="en" className="border-s-2 border-line ps-3 text-start text-xs leading-5">{q}</blockquote></li>)}</ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {leg.officialLinks.length > 0 && (
        <div>
          <h4 className="font-semibold">{t("visaCheck.officialLinks")}</h4>
          <ul className="mt-1 space-y-1">
            {leg.officialLinks.map((l) => (
              <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-royal underline"><Auto className="truncate">{l.kind === "TRUSTED" ? l.title : t(`visaCheck.linkKinds.${l.kind}`)}</Auto><ExternalLink className="size-3.5 shrink-0" aria-hidden /></a></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Disclaimer() {
  const { t } = useI18n()
  return (
    <aside className="mt-8 max-w-3xl rounded-2xl border border-line px-5 py-4 text-sm leading-6" aria-labelledby="vc-disclaimer">
      <h2 id="vc-disclaimer" className="font-semibold">{t("visaCheck.disclaimerTitle")}</h2>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-steel">
        <li>{t("visaCheck.disclaimer1")}</li>
        <li>{t("visaCheck.disclaimer2")}</li>
        <li>{t("visaCheck.disclaimer3")}</li>
        <li>{t("visaCheck.disclaimer4")}</li>
      </ul>
    </aside>
  )
}

/** The existing VISA service request (ADR-0015, O6): a request for help, never a visa application. Prefilled from the check when there is one. */
function VisaRequestForm({ prefill }: { prefill: { destination: string; purpose: RequestPurpose; date: string } | null }) {
  const { t, locale } = useI18n()
  // The request form offers the corridors Uni Travel serves; a checked destination outside them is added so it can be chosen.
  const destinations = useMemo(() => {
    const base = COUNTRIES.filter((c) => c !== "IR")
    return prefill && !base.includes(prefill.destination) && prefill.destination !== "IR" ? [prefill.destination, ...base] : base
  }, [prefill])
  const [f, setF] = useState({
    destinationCountry: prefill && destinations.includes(prefill.destination) ? prefill.destination : "GB", purpose: prefill?.purpose ?? ("TOURISM" as RequestPurpose),
    intendedTravelDate: prefill?.date && prefill.date >= today() ? prefill.date : inDays(30), linkedFlightRequestRef: "", note: "",
  })
  const details = {
    destinationCountry: f.destinationCountry, purpose: f.purpose, intendedTravelDate: f.intendedTravelDate,
    ...(f.linkedFlightRequestRef.trim() ? { linkedFlightRequestRef: f.linkedFlightRequestRef.trim().toUpperCase() } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}),
  }
  return (
    <ServiceFormFrame type="VISA" menuKey="visa" title={t("visaCheck.helpTitle")} lead={t("visaCheck.helpLead")} withTravellers details={details} valid={!!f.intendedTravelDate} embedded>
      <Field id="v-dest" label={t("services.destinationCountry")}>
        <CountrySelect id="v-dest" className={inputCls} value={f.destinationCountry} onChange={(e) => setF({ ...f, destinationCountry: e.target.value })}>{destinations.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}</CountrySelect>
      </Field>
      <Field id="v-purpose" label={t("services.purpose")}>
        <select id="v-purpose" className={inputCls} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value as RequestPurpose })}>{REQUEST_PURPOSES.map((p) => <option key={p} value={p}>{t(`services.purposes.${p}`)}</option>)}</select>
      </Field>
      <Field id="v-date" label={t("services.intendedTravelDate")}><input id="v-date" type="date" className={inputCls} min={today()} value={f.intendedTravelDate} onChange={(e) => setF({ ...f, intendedTravelDate: e.target.value })} required /></Field>
      <Field id="v-ref" label={t("services.linkedFlight")} optional><input id="v-ref" className={inputCls} dir="ltr" placeholder="UT-…" value={f.linkedFlightRequestRef} onChange={(e) => setF({ ...f, linkedFlightRequestRef: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field id="v-note" label={t("services.note")} optional><textarea id="v-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
    </ServiceFormFrame>
  )
}
