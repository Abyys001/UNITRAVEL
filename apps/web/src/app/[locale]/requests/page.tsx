"use client"

import { useQuery } from "@tanstack/react-query"
import { Package, Plane } from "lucide-react"
import Link from "next/link"

import { Ltr } from "@/components/badges"
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
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-3xl">{t("requests.title")}</h1>
      {cached && <p className="mt-3 rounded bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-fg">{t("requests.offline")} {t("requests.lastUpdated", { time: date(cached.at, { withTime: true }) })}</p>}
      {q.isLoading && <div className="mt-6 h-40 animate-pulse rounded-lg bg-muted" />}
      {!q.isLoading && !items.length && <p className="mt-6 text-slate">{t("requests.empty")}</p>}
      <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-white">
        {items.map((r) => (
          <li key={r.ref}>
            <Link href={href(r.productType === "FLIGHT" ? `/requests/${r.ref}` : `/cargo/${r.ref}`)} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-paper">
              <span className="flex items-center gap-3">
                {r.productType === "FLIGHT" ? <Plane className="size-4 text-copper-700 rtl:-scale-x-100" /> : <Package className="size-4 text-copper-700" />}
                <span><span className="block font-medium">{r.routeLabel}</span><span className="text-xs text-slate"><Ltr className="font-mono">{r.ref}</Ltr>{sep}{r.firstDate ? date(r.firstDate, { dateOnly: true }) : ""}</span></span>
              </span>
              <span className="flex items-center gap-2">{r.unread > 0 && <span className="rounded-full bg-copper px-2 text-xs text-white">{r.unread}</span>}<span className="rounded-full border border-border px-2.5 py-0.5 text-xs">{r.statusLabel}</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
