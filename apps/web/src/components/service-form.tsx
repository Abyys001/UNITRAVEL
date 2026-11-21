"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowDown, CircleAlert, CalendarClock, ClipboardCheck, FileSearch, Headset, LifeBuoy, MessagesSquare, PhoneCall, ReceiptText, Send, ShieldCheck, Stamp, Umbrella, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import type { MenuKey, ServiceRequestType, TravellerView } from "@unitravel/contracts"
import type { MessageKey } from "@unitravel/i18n"
import { ServiceScene, type SceneKind } from "@unitravel/ui/brand/scenes"
import { Spinner } from "@unitravel/ui/components/spinner"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { Auto } from "@/components/badges"
import { ConfirmationPanel, type ConfirmationPanelProps, type FieldErrors, SelectField } from "@/components/form"
import { HeroBand, type HeroPhoto, ServiceHero } from "@/components/service-hero"
import { api, ApiError, newIdempotencyKey } from "@/lib/api"
import { restoreForm, saveDraft, snapshotForm, takeDraft } from "@/lib/form-draft"
import { useI18n } from "@/lib/i18n"
import { useSite } from "@/lib/site"
import { useSession } from "@/lib/session"

export const today = () => new Date().toISOString().slice(0, 10)
export const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)

/** Labelled form field; `htmlFor` ties the label to the control for screen readers. */
export function Field({ id, label, optional, children }: { id: string; label: string; optional?: boolean; children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium">{label}{optional && <span className="text-steel"> ({t("common.optional")})</span>}</label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

export const inputCls = "field h-10 w-full"

/** A page whose flag is off (or a vertical without a provider): an honest notice and the way to support, never fake listings. */
const SCENE: Record<ServiceRequestType, SceneKind> = { VISA: "visa", TOUR_CALLBACK: "flight", CIP: "cip", INSURANCE: "stay", HOTEL: "stay", STAY: "stay", TRAIN: "train", BUS: "bus" }

type HeroCopy = { eyebrow: MessageKey; accent: MessageKey; photo: HeroPhoto; perks: [LucideIcon, MessageKey][] }
/** Page header copy for the stand-alone request pages; perks only restate what the page lead already promises. */
const HERO: Partial<Record<ServiceRequestType, HeroCopy>> = {
  VISA: { eyebrow: "services.visaEyebrow", accent: "services.visaAccent", photo: "london", perks: [[FileSearch, "services.visaPerk1"], [ReceiptText, "services.visaPerk2"], [Stamp, "services.visaPerk3"]] },
  TOUR_CALLBACK: { eyebrow: "services.toursEyebrow", accent: "services.toursAccent", photo: "istanbul", perks: [[PhoneCall, "services.toursPerk1"], [MessagesSquare, "services.toursPerk2"], [CalendarClock, "services.toursPerk3"]] },
  INSURANCE: { eyebrow: "services.insuranceEyebrow", accent: "services.insuranceAccent", photo: "travel", perks: [[Umbrella, "services.insurancePerk1"], [ReceiptText, "services.insurancePerk2"], [ShieldCheck, "services.insurancePerk3"]] },
}

/** What happens after sending: the same three steps for every request type (ADR-0015), never a promise of a booking. */
function NextSteps() {
  const { t, href } = useI18n()
  const steps: [LucideIcon, MessageKey][] = [[Send, "services.next1"], [Headset, "services.next2"], [ClipboardCheck, "services.next3"]]
  return (
    <aside className="card-brand self-start p-5 lg:sticky lg:top-24" data-testid="service-next">
      <h2 className="font-display text-lg">{t("services.nextTitle")}</h2>
      <ol className="mt-4 space-y-4">
        {steps.map(([Icon, k], i) => (
          <li key={k} className="relative flex gap-3 text-sm leading-6">
            {i < steps.length - 1 && <span aria-hidden className="absolute start-[1.1rem] top-10 h-[calc(100%-1.5rem)] border-s-2 border-dashed border-orange/50" />}
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-orange bg-white text-navy-900"><Icon className="size-4" /></span>
            <span className="pt-1.5">{t(k)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-line pt-4 text-sm text-steel">{t("services.nextHelp")} <Link href={href("/support")} className="font-semibold text-royal underline">{t("nav.support")}</Link></p>
    </aside>
  )
}

export function Unavailable({ title, band }: { title: string; band?: boolean }) {
  const { t, href } = useI18n()
  return (
    <>{band && <HeroBand />}<div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{title}</h1>
      <div className="mt-6" data-testid="service-unavailable">
        <EmptyState icon={<LifeBuoy />} title={t("services.unavailableTitle")} body={t("services.unavailableBody")} action={<Link href={href("/support")} className="btn-orange mt-2 inline-flex">{t("nav.support")}</Link>} />
      </div>
    </div></>
  )
}


/** Problem paths ("details.flightNumber") as field errors; `prefix` is stripped so wizard keys match their values. */
export function problemFieldErrors(e: ApiError, message: string, prefix = ""): FieldErrors {
  const out: FieldErrors = {}
  for (const x of e.problem.errors ?? []) {
    const p = prefix && x.path.startsWith(prefix) ? x.path.slice(prefix.length) : x.path
    // Contract messages are English developer text; the visitor sees the translated one.
    out[p] ??= message
  }
  return out
}

type Ack = { notABooking: boolean; privacy: boolean }

/**
 * The one submit path for service requests (ADR-0015, ADR-0041): contact phone, travellers, acknowledgements, the
 * sign-in round trip and the POST with an idempotency key. ServiceFormFrame and the Visa/CIP wizards both use it.
 */
export function useServiceSubmit(type: ServiceRequestType, opts: { withTravellers?: boolean } = {}) {
  const { t, href } = useI18n()
  const router = useRouter()
  const path = usePathname()
  const { me, loading } = useSession()
  const travellers = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: !!me && !!opts.withTravellers })
  const phones = me?.identities.filter((i) => i.type === "PHONE") ?? []
  const [phoneId, setPhoneId] = useState("")
  const contact = phoneId || phones.find((p) => p.verifiedAt)?.id || phones[0]?.id || ""
  const [chosen, setChosen] = useState<string[]>([])
  const [ack, setAck] = useState<Ack>({ notABooking: false, privacy: false })
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentRef, setSentRef] = useState<string | null>(null)
  const [key] = useState(newIdempotencyKey)

  /** What the shared part still needs, keyed like the API paths; empty when ready to send. */
  const missing = (travellerIds: string[] = chosen): FieldErrors => {
    const e: FieldErrors = {}
    const req = t("guide.common.required")
    if (me && !contact) e.contactIdentityId = req
    if (me && opts.withTravellers && travellerIds.length === 0) e["details.travellerIds"] = req
    if (!ack.notABooking) e["acknowledgements.notABooking"] = req
    if (!ack.privacy) e["acknowledgements.privacy"] = req
    return e
  }

  /** Keeps the draft (the caller saves it), then asks for sign-in and comes back here. */
  const signIn = (saveDraftNow: () => void) => {
    saveDraftNow()
    router.push(href(`/sign-in?next=${encodeURIComponent(path)}`))
  }

  /** Resolves with the reference, or with the problem so a wizard can put its field errors on the right step. */
  const send = async (details: Record<string, unknown>, extra: { documentIds?: string[] } = {}): Promise<{ ref: string } | { error: ApiError }> => {
    setBusy(true); setError(null)
    try {
      const body = {
        type, contactIdentityId: contact, acknowledgements: { notABooking: true, privacy: true },
        details: opts.withTravellers && !("travellerIds" in details) ? { ...details, travellerIds: chosen } : details,
        ...(extra.documentIds?.length ? { documentIds: extra.documentIds } : {}),
      }
      const r = await api<{ ref: string }>("/v1/service-requests", { headers: { "idempotency-key": key }, body })
      try { sessionStorage.setItem(`sent:${r.ref}`, "1") } catch { /* storage unavailable */ }
      setSentRef(r.ref)
      return { ref: r.ref }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError({ status: 0, code: "INTERNAL", title: String(e) })
      setError(err)
      return { error: err }
    } finally {
      setBusy(false)
    }
  }

  return { me, loading, travellers, phones, contact, setContact: setPhoneId, chosen, setChosen, ack, setAck, missing, signIn, send, busy, error, sentRef }
}
export type ServiceSubmit = ReturnType<typeof useServiceSubmit>

const travellerName = (x: TravellerView, locale: string) => (locale === "fa" && x.nameFa ? x.nameFa : `${x.givenNames} ${x.surname}`)

/** Saved travellers as checkboxes; `extra` sits under the list (the visa wizard's "add a traveller"). */
export function TravellerPicker({ travellers, loading, chosen, onChange, error, legend, hint, extra }: {
  travellers: TravellerView[] | undefined; loading: boolean; chosen: string[]; onChange: (ids: string[]) => void
  error?: string; legend?: string; hint?: string; extra?: React.ReactNode
}) {
  const { t, href, locale } = useI18n()
  const list = travellers
  const toggle = (id: string, on: boolean) => onChange(on ? [...chosen, id] : chosen.filter((c) => c !== id))
  return (
    <fieldset className="min-w-0" aria-describedby={[hint ? "svc-travellers-hint" : "", error ? "svc-travellers-error" : ""].filter(Boolean).join(" ") || undefined} aria-invalid={error ? true : undefined}>
      <legend className="font-display px-1 text-lg">{legend ?? t("services.travellers")}</legend>
      {hint && <p id="svc-travellers-hint" className="mt-1 text-sm text-steel">{hint}</p>}
      {loading && <LoadingState label={t("common.loading")} rows={1} />}
      {list && list.length === 0 && !extra && <p className="text-sm text-steel">{t("services.noTravellers")} <Link className="font-semibold text-royal underline" href={href("/account/details")}>{t("services.addTravellers")}</Link></p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {list?.map((x) => (
          <label key={x.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors pointer-coarse:min-h-11 ${chosen.includes(x.id) ? "border-orange bg-orange/5" : "border-line bg-white"}`}>
            <input type="checkbox" className="size-4 accent-orange" checked={chosen.includes(x.id)} onChange={(e) => toggle(x.id, e.target.checked)} />
            <Auto>{travellerName(x, locale)}</Auto>
          </label>
        ))}
      </div>
      {extra}
      {error && <p id="svc-travellers-error" className="mt-2 flex items-start gap-1 text-xs font-medium text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />{error}</p>}
    </fieldset>
  )
}

/** Contact phone (or the sign-in note) and the two acknowledgements, with their field errors. */
export function RequestContact({ svc, errors = {} }: { svc: ServiceSubmit; errors?: FieldErrors }) {
  const { t, href } = useI18n()
  return (
    <div className="space-y-3">
      {!svc.me ? <p className="text-sm text-steel" data-testid="service-sign-in">{t("services.signInNote")}</p> : svc.phones.length === 0
        ? <p className="text-sm text-steel">{t("services.noPhone")} <Link className="font-semibold text-royal underline" href={href("/account")}>{t("nav.account")}</Link></p>
        : (
          <SelectField id="svc-contact" label={t("services.contact")} required value={svc.contact} onChange={svc.setContact} error={errors.contactIdentityId}
            // Isolated so a "+44…" number keeps its order inside Persian text.
            options={svc.phones.map((p) => ({ value: p.id, label: `⁦${p.value}⁩` }))} />
        )}
      {(["notABooking", "privacy"] as const).map((k) => {
        const err = errors[`acknowledgements.${k}`]
        return (
          <div key={k}>
            <label className="flex items-start gap-3 text-sm pointer-coarse:min-h-11">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-orange" checked={svc.ack[k]} aria-invalid={err ? true : undefined} aria-describedby={err ? `svc-ack-${k}-error` : undefined}
                onChange={(e) => svc.setAck({ ...svc.ack, [k]: e.target.checked })} />
              {t(k === "notABooking" ? "services.ackNotBooking" : "services.ackPrivacy")}
            </label>
            {err && <p id={`svc-ack-${k}-error`} className="ms-7 mt-1 flex items-start gap-1 text-xs font-medium text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />{err}</p>}
          </div>
        )
      })}
    </div>
  )
}

/** The problem from the last send: its title, plus any field it could not place beside a control. */
export function SubmitError({ error, placed = [] }: { error: ApiError | null; placed?: string[] }) {
  const { t } = useI18n()
  if (!error) return null
  const rest = (error.problem.errors ?? []).filter((e) => !placed.includes(e.path))
  return (
    <div role="alert" className="rounded-xl border-s-4 border-danger bg-danger-subtle px-4 py-3 text-sm">
      <p className="font-semibold">{error.problem.code === "FEATURE_DISABLED" ? t("services.unavailableTitle") : error.message}</p>
      {rest.map((e) => <p key={e.path} dir="auto">{e.path}: {e.message ?? e.code}</p>)}
    </div>
  )
}

/**
 * Shared frame for every service request form (ADR-0015): flag gate, sign-in, contact phone, travellers (when the type
 * needs them), the two acknowledgements and the submit. The page owns its own fields and passes the `details` object.
 */
export function ServiceFormFrame({ type, menuKey, title, lead, withTravellers, details, valid, embedded, hero, confirmation, children }: {
  type: ServiceRequestType; menuKey: MenuKey; title: string; lead: string; withTravellers?: boolean; details: Record<string, unknown>; valid: boolean
  /** Inside a landing page (hotels, ADR-0017): no page redirect to sign-in, an h2 heading, and nothing when the service is off. */
  embedded?: boolean
  /** Full-bleed page header (trains, buses) with its own h1. It sits inside the form so its fields survive the sign-in round trip. */
  hero?: React.ReactNode
  /** Overrides for the success panel; the default names the reference and links to the request page. */
  confirmation?: Partial<ConfirmationPanelProps>
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const { site, loaded } = useSite()
  const svc = useServiceSubmit(type, { withTravellers })
  const enabled = loaded && site.menu[menuKey] === true
  // Browsing is open: the form shows to everyone and sign-in is asked only when the request is sent.
  const formRef = useRef<HTMLFormElement>(null)

  // Restore what the visitor typed before the sign-in round trip (once the form has rendered).
  const formShown = loaded && enabled && !svc.loading
  useEffect(() => {
    if (!formShown || !formRef.current) return
    const d = takeDraft<{ form: Parameters<typeof restoreForm>[1]; ack: Ack }>(`svc:${type}`)
    if (!d) return
    restoreForm(formRef.current, d.form)
    svc.setAck(d.ack)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formShown])
  const copy = embedded ? undefined : HERO[type]
  const header = hero ?? (copy && (
    <ServiceHero testId="service-hero" eyebrow={t(copy.eyebrow)} title={title} accent={t(copy.accent)} lead={lead} scene={SCENE[type]} photo={copy.photo}
      perks={copy.perks.map(([icon, k]) => ({ icon, label: t(k) }))}
      actions={<a href="#request-details" className="btn-orange">{t("services.startRequest")}<ArrowDown className="size-4" aria-hidden /></a>} />
  ))
  // A page with its own hero has no shell band, so these states draw it themselves.
  if (loaded && !enabled) return embedded ? null : <Unavailable title={title} band={!!header} />
  if (!loaded || svc.loading) return <>{header && <HeroBand />}<div className="mx-auto max-w-3xl px-4 py-8"><LoadingState label={t("common.loading")} rows={3} /></div></>

  if (svc.sentRef) {
    const panel = (
      <ConfirmationPanel title={t("services.sentTitle")} lead={t("services.sentBody", { ref: svc.sentRef })} reference={svc.sentRef}
        steps={[t("services.next2"), t("services.next3")]} primary={{ href: `/services/${svc.sentRef}`, label: t("services.open") }} {...confirmation} />
    )
    return embedded ? panel : <>{header && <HeroBand />}<div className="mx-auto max-w-3xl px-4 py-8 md:py-10" data-testid="service-confirmation">{panel}</div></>
  }

  const ready = valid && svc.ack.notABooking && svc.ack.privacy && (!svc.me || (!!svc.contact && (!withTravellers || svc.chosen.length > 0)))
  const submit = async () => {
    if (!svc.me) {
      svc.signIn(() => { if (formRef.current) saveDraft(`svc:${type}`, { form: snapshotForm(formRef.current), ack: svc.ack }) })
      return
    }
    // The button stays disabled until the shared part is complete, so only server errors can come back here.
    await svc.send(details)
  }
  // Server field errors beside the controls the frame owns; the page's own fields are listed in the alert.
  const shown = svc.error ? problemFieldErrors(svc.error, t("guide.common.invalid")) : {}
  const placed = ["contactIdentityId", "details.travellerIds", "acknowledgements.notABooking", "acknowledgements.privacy"]

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); if (ready && !svc.busy) void submit() }
  const fields = (
    <>
        <fieldset className="card-brand grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 p-5 sm:grid-cols-2">{children}</fieldset>

        {withTravellers && !!svc.me && <div className="card-brand p-5"><TravellerPicker travellers={svc.travellers.data} loading={svc.travellers.isLoading} chosen={svc.chosen} onChange={svc.setChosen} error={shown["details.travellerIds"]} /></div>}

        <fieldset className="card-brand p-5">
          <legend className="font-display px-1 text-lg">{t("services.contact")}</legend>
          <RequestContact svc={svc} errors={shown} />
        </fieldset>

        <SubmitError error={svc.error} placed={placed} />
        <button type="submit" className="btn-orange inline-flex items-center gap-2" disabled={!ready || svc.busy} aria-disabled={!ready || svc.busy}>
          {svc.busy && <Spinner role="presentation" aria-hidden aria-label={undefined} className="size-4" />}
          {svc.busy ? t("guide.common.submitting") : svc.me ? t("services.submit") : t("services.signInToSend")}
        </button>
    </>
  )

  if (header) {
    return (
      <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={svc.busy}>
        {header}
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-16 pt-8 md:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div id="request-details" className="min-w-0 scroll-mt-24 space-y-6">
            <h2 className="font-display text-2xl md:text-3xl">{t("services.groundDetailsTitle")}</h2>
            {fields}
          </div>
          <NextSteps />
        </div>
      </form>
    )
  }

  return (
    <div className={embedded ? "" : "mx-auto max-w-5xl px-4 py-8 md:py-10"}>
      <div className="grid items-center gap-6 md:grid-cols-[1fr_16rem]">
        <div>
          {embedded ? <h2 className="font-display text-3xl md:text-4xl">{title}</h2> : <h1 className="font-display text-3xl md:text-4xl">{title}</h1>}
          <p className="mt-3 max-w-2xl leading-7 text-steel">{lead}</p>
        </div>
        <ServiceScene kind={SCENE[type]} className="hidden aspect-[5/3] md:block" />
      </div>
      <form ref={formRef} className="mt-6 max-w-3xl space-y-6" onSubmit={onSubmit} noValidate aria-busy={svc.busy}>{fields}</form>
    </div>
  )
}
