"use client"

import { useQuery } from "@tanstack/react-query"
import { Mail, Phone } from "lucide-react"
import Link from "next/link"

import type { CustomerTicketSummary } from "@unitravel/contracts"

import { Ltr } from "@/components/badges"
import { SupportForm } from "@/components/support-form"
import { api } from "@/lib/api"

import { PanelFrame } from "@/components/customer-panel"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { useSite } from "@/lib/site"

/**
 * Support (spec §4.6): phone and email come from Developer Panel › Settings through GET /v1/site. Placeholder contacts
 * are never shown, and hours appear only once the client has confirmed them (O13, O15): no 24-hour claim.
 */
export default function SupportPage() {
  const { t, href, locale } = useI18n()
  const { me } = useSession()
  const { site, loaded } = useSite()
  const { phone, email, hours } = site.support
  const tickets = useQuery({ queryKey: ["support-tickets"], queryFn: () => api<CustomerTicketSummary[]>("/v1/support/tickets"), enabled: !!me })
  return (
    <PanelFrame enabled={!!me}>
    <div className={me ? "" : "mx-auto max-w-5xl px-4 py-8 md:py-10"}>
      <h1 className="font-display text-3xl md:text-4xl">{t("support.title")}</h1>
      <p className="mt-3 leading-7 text-steel">{t("support.lead")}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <SupportForm onSent={() => void tickets.refetch()} />
        <aside className="space-y-4">
          <div className="card-brand space-y-4 p-5" data-testid="support-contacts">
            {loaded && !phone && !email && <p className="text-steel">{t("support.soon")}</p>}
            {phone && <p className="flex flex-wrap items-center gap-3"><Phone aria-hidden className="size-5 text-royal" /><span className="text-sm text-steel">{t("support.phone")}</span><a className="font-semibold text-navy-950 underline underline-offset-4" href={`tel:${phone.replace(/\s/g, "")}`} dir="ltr">{phone}</a></p>}
            {email && <p className="flex flex-wrap items-center gap-3"><Mail aria-hidden className="size-5 text-royal" /><span className="text-sm text-steel">{t("support.email")}</span><a className="font-semibold text-navy-950 underline underline-offset-4" href={`mailto:${email}`} dir="ltr">{email}</a></p>}
            {hours && <p className="text-sm"><span className="text-steel">{t("support.hours")}: </span>{hours[locale]}</p>}
          </div>
          {me && (
            <section className="card-brand p-5" aria-labelledby="tk-h" data-testid="support-tickets">
              <h2 id="tk-h" className="font-display text-xl">{t("support.ticketsTitle")}</h2>
              {tickets.data && tickets.data.length === 0 && <p className="mt-2 text-sm text-steel">{t("support.noTickets")}</p>}
              <ul className="mt-2 divide-y divide-line">
                {tickets.data?.map((k) => (
                  <li key={k.ref}><Link href={href(`/support/${k.ref}`)} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-royal"><span className="min-w-0"><span className="block truncate font-semibold" dir="auto">{k.subject}</span><Ltr className="font-mono text-xs text-steel">{k.ref}</Ltr></span><span className="shrink-0 rounded-full bg-cloud px-2.5 py-1 text-xs font-semibold">{t(`support.status.${k.status}`)}</span></Link></li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
      <ul className="mt-6 space-y-2 text-sm">
        <li><Link className="font-semibold text-royal underline underline-offset-4" href={href("/faq")}>{t("support.faq")}</Link></li>
        {me && <li><Link className="font-semibold text-royal underline underline-offset-4" href={href("/requests")}>{t("support.message")}</Link></li>}
      </ul>
    </div>
    </PanelFrame>
  )
}
