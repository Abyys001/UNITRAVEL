"use client"

import { Mail, Phone } from "lucide-react"
import Link from "next/link"

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
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("support.title")}</h1>
      <p className="mt-3 leading-7 text-steel">{t("support.lead")}</p>
      <div className="card-brand mt-6 space-y-4 p-6" data-testid="support-contacts">
        {loaded && !phone && !email && <p className="text-steel">{t("support.soon")}</p>}
        {phone && <p className="flex items-center gap-3"><Phone aria-hidden className="size-5 text-royal" /><span className="text-sm text-steel">{t("support.phone")}</span><a className="font-semibold text-navy-950 underline underline-offset-4" href={`tel:${phone.replace(/\s/g, "")}`} dir="ltr">{phone}</a></p>}
        {email && <p className="flex items-center gap-3"><Mail aria-hidden className="size-5 text-royal" /><span className="text-sm text-steel">{t("support.email")}</span><a className="font-semibold text-navy-950 underline underline-offset-4" href={`mailto:${email}`} dir="ltr">{email}</a></p>}
        {hours && <p className="text-sm"><span className="text-steel">{t("support.hours")}: </span>{hours[locale]}</p>}
      </div>
      <ul className="mt-6 space-y-2 text-sm">
        <li><Link className="font-semibold text-royal underline underline-offset-4" href={href("/faq")}>{t("support.faq")}</Link></li>
        {me && <li><Link className="font-semibold text-royal underline underline-offset-4" href={href("/requests")}>{t("support.message")}</Link></li>}
      </ul>
    </div>
  )
}
