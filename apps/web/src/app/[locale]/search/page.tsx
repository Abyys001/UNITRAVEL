"use client"

import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Loader2 } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"

import type { ResultTab, SearchState } from "@unitravel/contracts"

import { ResultCard } from "@/components/result-card"
import { type SearchParamsShape, SearchForm, toQuery } from "@/components/search-form"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

const TABS: ResultTab[] = ["BEST", "CHEAPEST", "FASTEST", "SINGLE_TICKET"]

function decode(q: string | null): SearchParamsShape | null {
  try { return q ? (JSON.parse(decodeURIComponent(escape(atob(q)))) as SearchParamsShape) : null } catch { return null }
}

function Results() {
  const { t, href, sep, date } = useI18n()
  const sp = useSearchParams()
  const params = useMemo(() => decode(sp.get("q")), [sp])
  const [searchId, setSearchId] = useState<string | null>(null)
  const [tab, setTab] = useState<ResultTab>("BEST")
  const [version, setVersion] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const started = useRef<string | null>(null)

  useEffect(() => {
    const key = sp.get("q")
    if (!params || started.current === key) return
    started.current = key
    setSearchId(null); setErr(null); setVersion(0)
    api<{ id: string }>("/v1/flight-searches", { body: toQuery(params) }).then((r) => setSearchId(r.id)).catch((e: Error) => setErr(e.message))
  }, [params, sp])

  // Server-sent events on the web; the page re-fetches on each "results" event (ch. 24.9), polling as a fallback.
  useEffect(() => {
    if (!searchId) return
    const es = new EventSource(`/api/v1/flight-searches/${searchId}/events`)
    es.addEventListener("results", (e) => setVersion(JSON.parse((e as MessageEvent).data).version))
    es.addEventListener("progress", () => setVersion((v) => v))
    es.addEventListener("done", () => { setVersion((v) => v + 1000); es.close() })
    es.onerror = () => es.close()
    return () => es.close()
  }, [searchId])

  const q = useQuery({
    queryKey: ["search", searchId, tab, version],
    queryFn: () => api<SearchState & { total: number }>(`/v1/flight-searches/${searchId}?tab=${tab}&limit=40`),
    enabled: !!searchId,
    refetchInterval: (query) => (query.state.data?.status === "RUNNING" ? 1500 : false),
    placeholderData: (prev) => prev,
  })
  const s = q.data
  if (!params) return <p className="p-8">{t("common.error")}</p>
  const running = !s || s.status === "RUNNING"
  const manualHref = href(`/request/new?manual=${encodeURIComponent(sp.get("q") ?? "")}`)
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <details className="mb-5 rounded-lg border border-border bg-white"><summary className="cursor-pointer px-4 py-3 text-sm"><span className="font-medium">{params.from.label} → {params.to.label}</span>{sep}{date(params.date, { dateOnly: true, weekday: true })}</summary><div className="p-3"><SearchForm initial={params} /></div></details>
      <div aria-live="polite" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate">
        {running && <Loader2 className="size-4 animate-spin text-copper-700" />}
        <span>{s ? (running ? t("results.progress", { total: s.progress.sourcesTotal || "…", done: s.progress.sourcesDone }) : t("results.complete", { count: (s as { total: number }).total })) : t("common.loading")}</span>
        {s?.notices.includes("POLICY_HIDDEN") && <span className="rounded bg-warning-subtle px-2 py-0.5 text-warning-subtle-fg">{t("results.policyHidden")}</span>}
        {s?.notices.includes("NO_SOURCES") && <span className="rounded bg-warning-subtle px-2 py-0.5 text-warning-subtle-fg">{t("results.noSources")}</span>}
        {!!s?.progress.slowSources.length && <span>{t("results.slow")}</span>}
      </div>
      {s?.historical && <p className="mb-4 rounded-md bg-info-subtle px-3 py-2 text-sm text-info-subtle-fg">{t("results.historical")}</p>}
      {err && <p className="mb-4 flex items-center gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-fg"><AlertTriangle className="size-4" />{err}</p>}
      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div>
          <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === k ? "border-copper font-medium text-ink" : "border-transparent text-slate"}`}>{t(`results.tabs.${k}`)}</button>)}
          </div>
          <ul className="space-y-3">
            {s?.results.map((it) => <li key={it.id}><ResultCard it={it} searchId={s.id} /></li>)}
            {running && !s?.results.length && Array.from({ length: 3 }).map((_, i) => <li key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}
          </ul>
          {!running && !s?.results.length && (
            <div className="rounded-lg border border-dashed border-copper/60 bg-white p-8 text-center">
              <h2 className="font-display text-2xl">{t("results.empty")}</h2>
              <p className="mx-auto mt-2 max-w-md text-slate">{t("results.emptyBody")}</p>
              <Link href={manualHref} className="mt-5 inline-block rounded-md bg-primary px-4 py-2.5 text-primary-foreground">{t("results.askTeam")}</Link>
            </div>
          )}
        </div>
        <aside className="space-y-4 text-sm">
          <div className="rounded-lg border border-border bg-sand p-4"><p className="text-slate">{t("results.illustrative")}</p></div>
          <div className="rounded-lg border border-border bg-white p-4"><p className="font-medium">{t("results.talk")}</p><p className="mt-1 text-slate">{t("results.emptyBody")}</p><Link href={manualHref} className="mt-3 inline-block text-copper-700 underline underline-offset-4">{t("results.askTeam")}</Link></div>
        </aside>
      </div>
    </div>
  )
}

export default function SearchPage() {
  return <Suspense><Results /></Suspense>
}
