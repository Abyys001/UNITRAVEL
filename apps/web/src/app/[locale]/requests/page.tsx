"use client"

import { useQuery } from "@tanstack/react-query"
import { Package, Plane, Ticket } from "lucide-react"
import Link from "next/link"

import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { Ltr, RouteLabel } from "@/components/badges"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { cacheGet, cacheSet, useRequireSignIn } from "@/lib/use-auth-redirect"

interface Item { ref: string; productType: "FLIGHT" | "CARGO"; status: string; statusLabel: string; routeLabel: string; firstDate: string | null; submittedAt: string; unread: number }

export default function RequestsPage() {
  const { t, href, date, sep } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["requests"], queryFn: async () => { const r = await api<Item[]>("/v1/requests"); cacheSet("requests", r); return r }, enabled: !!me, refetchInterval: 30_000 })
  const cached = !q.data && q.isError ? cacheGet<Item[]>("requests") : null
  const items = q.data ?? cached?.data ?? []
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("requests.title")}</h1>
      {cached && <p className="mt-4 rounded-xl bg-warning-subtle px-4 py-2.5 text-sm text-warning-subtle-fg">{t("requests.offline")} {t("requests.lastUpdated", { time: date(cached.at, { withTime: true }) })}</p>}
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {!q.isLoading && !items.length && <EmptyState className="mt-6" icon={<Ticket />} title={t("requests.empty")} />}
      <ul className="card-brand mt-6 divide-y divide-line overflow-hidden">
        {items.map((r) => (
          <li key={r.ref}>
            <Link href={href(r.productType === "FLIGHT" ? `/requests/${r.ref}` : `/cargo/${r.ref}`)} className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-cloud focus-visible:outline-2 focus-visible:outline-orange sm:px-5">
              <span className="flex items-center gap-4">
                {r.productType === "FLIGHT" ? <Plane className="size-4 rotate-45 text-navy-900 rtl:-rotate-45 rtl:-scale-x-100" aria-hidden /> : <Package className="size-4 text-navy-900" aria-hidden />}
                <span><span className="block font-display text-lg"><RouteLabel label={r.routeLabel} /></span><span className="text-xs text-steel"><Ltr className="font-mono">{r.ref}</Ltr>{sep}{r.firstDate ? date(r.firstDate, { dateOnly: true }) : ""}</span></span>
              </span>
              <span className="flex items-center gap-2">{r.unread > 0 && <span className="rounded-full bg-orange px-2 py-0.5 text-xs font-bold text-navy-950">{r.unread}</span>}<span className="rounded-full border border-navy-900/30 bg-cloud px-3 py-1 text-xs font-semibold text-navy-900">{r.statusLabel}</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
