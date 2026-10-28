"use client"

import { useQuery } from "@tanstack/react-query"
import { LifeBuoy } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import type { MenuKey, ServiceRequestType, TravellerView } from "@unitravel/contracts"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { Auto } from "@/components/badges"
import { api, ApiError, newIdempotencyKey } from "@/lib/api"
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
export function Unavailable({ title }: { title: string }) {
  const { t, href } = useI18n()
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{title}</h1>
      <div className="mt-6" data-testid="service-unavailable">
        <EmptyState icon={<LifeBuoy />} title={t("services.unavailableTitle")} body={t("services.unavailableBody")} action={<Link href={href("/support")} className="btn-orange mt-2 inline-flex">{t("nav.support")}</Link>} />
      </div>
    </div>
  )
}

/**
 * Shared frame for every service request form (ADR-0015): flag gate, sign-in, contact phone, travellers (when the type
 * needs them), the two acknowledgements and the submit. The page owns its own fields and passes the `details` object.
 */
export function ServiceFormFrame({ type, menuKey, title, lead, withTravellers, details, valid, children }: {
  type: ServiceRequestType; menuKey: MenuKey; title: string; lead: string; withTravellers?: boolean; details: Record<string, unknown>; valid: boolean; children: React.ReactNode
}) {
  const { t, href, locale } = useI18n()
  const router = useRouter()
  const { site, loaded } = useSite()
  const { me, loading } = useSession()
  const path = usePathname()
  const enabled = loaded && site.menu[menuKey] === true
  // Sign-in is needed only to send a request: a switched-off service shows its notice to everyone, signed in or not.
  useEffect(() => { if (enabled && !loading && !me) router.replace(href(`/sign-in?next=${encodeURIComponent(path)}`)) }, [enabled, loading, me, router, path, href])
  const travellers = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: !!me && !!withTravellers })
  const phones = me?.identities.filter((i) => i.type === "PHONE") ?? []
  const [phoneId, setPhoneId] = useState<string>("")
  const contact = phoneId || phones.find((p) => p.verifiedAt)?.id || phones[0]?.id || ""
  const [chosen, setChosen] = useState<string[]>([])
  const [ack, setAck] = useState({ notABooking: false, privacy: false })
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [key] = useState(newIdempotencyKey)

  if (loaded && !enabled) return <Unavailable title={title} />
  if (!loaded || loading || !me) return <div className="mx-auto max-w-3xl px-4 py-8"><LoadingState label={t("common.loading")} rows={3} /></div>

  const ready = valid && !!contact && ack.notABooking && ack.privacy && (!withTravellers || chosen.length > 0)
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const body = { type, contactIdentityId: contact, acknowledgements: { notABooking: true, privacy: true }, details: withTravellers ? { ...details, travellerIds: chosen } : details }
      const r = await api<{ ref: string }>("/v1/service-requests", { headers: { "idempotency-key": key }, body })
      try { sessionStorage.setItem(`sent:${r.ref}`, "1") } catch { /* storage unavailable */ }
      router.push(href(`/services/${r.ref}`))
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError({ status: 0, code: "INTERNAL", title: String(e) }))
      setBusy(false)
    }
  }
  const name = (x: TravellerView) => (locale === "fa" && x.nameFa ? x.nameFa : `${x.givenNames} ${x.surname}`)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl leading-7 text-steel">{lead}</p>
      <form className="mt-6 space-y-6" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void submit() }} noValidate>
        <fieldset className="card-brand grid gap-4 p-5 sm:grid-cols-2">{children}</fieldset>

        {withTravellers && (
          <fieldset className="card-brand p-5">
            <legend className="font-display px-1 text-lg">{t("services.travellers")}</legend>
            {travellers.isLoading && <LoadingState label={t("common.loading")} rows={1} />}
            {travellers.data && travellers.data.length === 0 && <p className="text-sm text-steel">{t("services.noTravellers")} <Link className="font-semibold text-royal underline" href={href("/account/details")}>{t("services.addTravellers")}</Link></p>}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {travellers.data?.map((x) => (
                <label key={x.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm pointer-coarse:min-h-11">
                  <input type="checkbox" className="size-4 accent-orange" checked={chosen.includes(x.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, x.id] : chosen.filter((c) => c !== x.id))} />
                  <Auto>{name(x)}</Auto>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="card-brand space-y-3 p-5">
          <legend className="font-display px-1 text-lg">{t("services.contact")}</legend>
          {phones.length === 0
            ? <p className="text-sm text-steel">{t("services.noPhone")} <Link className="font-semibold text-royal underline" href={href("/account")}>{t("nav.account")}</Link></p>
            : (
              <select aria-label={t("services.contact")} className={inputCls} value={contact} onChange={(e) => setPhoneId(e.target.value)} dir="ltr">
                {phones.map((p) => <option key={p.id} value={p.id}>{p.value}</option>)}
              </select>
            )}
          {(["notABooking", "privacy"] as const).map((k) => (
            <label key={k} className="flex items-start gap-3 text-sm pointer-coarse:min-h-11">
              <input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={ack[k]} onChange={(e) => setAck({ ...ack, [k]: e.target.checked })} />
              {t(k === "notABooking" ? "services.ackNotBooking" : "services.ackPrivacy")}
            </label>
          ))}
        </fieldset>

        {err && (
          <div role="alert" className="rounded-xl border-s-4 border-danger bg-danger-subtle px-4 py-3 text-sm">
            <p className="font-semibold">{err.problem.code === "FEATURE_DISABLED" ? t("services.unavailableTitle") : err.message}</p>
            {err.problem.errors?.map((e) => <p key={e.path} dir="auto">{e.path}: {e.message ?? e.code}</p>)}
          </div>
        )}
        <button type="submit" className="btn-orange" disabled={!ready || busy} aria-disabled={!ready || busy}>{t("services.submit")}</button>
      </form>
    </div>
  )
}
