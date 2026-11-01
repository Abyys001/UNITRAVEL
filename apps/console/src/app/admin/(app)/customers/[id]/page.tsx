"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"

import type { TravellerView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { Country } from "@unitravel/ui/product/country"
import { AssignServiceDialog } from "@/components/assign-service"
import { ListSkeleton, PanelTabs, StateChip, SummaryItem, TableScroll } from "@/components/case"
import { DirectInvoiceDialog } from "@/components/direct-invoice-form"
import { CustomerActivity } from "@/components/customer-activity"
import { Empty, ErrorLine, PageHead, Panel, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Context {
  id: string; displayName: string; preferredLocale: string; timezone: string
  profile: { givenNamesLatin: string | null; surnameLatin: string | null; nameFa: string | null; contactTimePref: string | null } | null
  identities: { type: string; value: string; verifiedAt: string | null; isPrimary: boolean }[]
  travellers: TravellerView[]
}

/** Customer context (ch. 15.2): needs customer.read.pii; passport numbers only through the audited Reveal. */
function Customer() {
  const { id } = useParams<{ id: string }>()
  const params = useSearchParams()
  const ref = params.get("ref") ?? undefined
  const { can } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<Context>(`/v1/admin/customers/${id}`) })
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const reveal = useAct((tid: string) => api<{ number: string }>(`/v1/admin/customers/travellers/${tid}/reveal-document`, { body: { ref } }).then((r) => ({ tid, n: r.number })), { onDone: ({ tid, n }) => setRevealed((x) => ({ ...x, [tid]: n })) })
  const [tab, setTab] = useState<"overview" | "activity">(() => (params.get("tab") === "activity" ? "activity" : "overview"))
  const [assigning, setAssigning] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const router = useRouter()
  const c = q.data
  const showActivity = can("customer.read")
  return (
    <div>
      <PageHead kicker={<>{t("cu.detail")}{ref && <> · {t("cd.from")} <Link className="ref hover:underline" href={ref.startsWith("UT-C-") ? `/cargo/${ref}` : `/requests/${ref}`}>{ref}</Link></>}</>} title={<span dir="auto">{!c ? t("cu.detail") : c.profile?.givenNamesLatin ? `${c.profile.givenNamesLatin} ${c.profile.surnameLatin ?? ""}` : c.displayName}</span>}>
        {c?.profile?.nameFa && <span className="font-fa text-lg" dir="rtl" lang="fa">{c.profile.nameFa}</span>}
        {can("invoice.direct") && c && <Button size="sm" variant="outline" onClick={() => setInvoicing(true)} data-testid="new-invoice">{t("invd.new")}</Button>}
        {can("service.assign") && <Button size="sm" onClick={() => setAssigning(true)} data-testid="assign-service">{t("as.open")}</Button>}
      </PageHead>
      {showActivity && <div className="px-4 md:px-6"><PanelTabs id="cust" label={t("cu.tabs")} value={tab} onChange={setTab} tabs={[{ key: "overview", label: t("cu.tab.overview") }, { key: "activity", label: t("cu.tab.activity") }]} /></div>}
      {tab === "activity" && showActivity && <div className="px-4 pt-3 pb-6 md:px-6" id="cust-pane-activity" role="tabpanel" aria-labelledby="cust-tab-activity"><CustomerActivity customerId={id} /></div>}
      {(tab === "overview" || !showActivity) && (q.error ? <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div> : !c ? <ListSkeleton rows={5} /> : <div id="cust-pane-overview" role="tabpanel" aria-labelledby="cust-tab-overview">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule bg-surface-raised px-5 py-3" data-testid="case-summary">
        <SummaryItem label={t("cust.verified")}><span className="num font-semibold">{c.identities.filter((i) => i.verifiedAt).length}<span className="font-normal text-steel"> / {c.identities.length}</span></span>{c.identities.some((i) => !i.verifiedAt) && <span className="text-meta font-medium text-danger">{t("cd.unverifiedIdentity")}</span>}</SummaryItem>
        <SummaryItem label={t("cust.travellers")}><span className="num font-semibold">{c.travellers.length}</span></SummaryItem>
        <SummaryItem label={t("cust.docs")}><span className="num font-semibold">{c.travellers.filter((x) => x.document).length}</span>{c.travellers.filter((x) => x.document).map((x) => <StateChip key={x.id} value={x.verification.status} />)}</SummaryItem>
        <SummaryItem label={t("cust.lang")}><span className="font-medium">{t(c.preferredLocale === "fa" ? "lang.name.fa" : "lang.name.en")}</span><span className="text-meta text-steel">{c.timezone}</span></SummaryItem>
      </div>
      <div className="grid gap-x-8 px-5 pt-2 lg:grid-cols-2">
        <Panel title={t("cust.profile")}>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
            <dt className="text-steel">{t("cd.displayName")}</dt><dd dir="auto">{c.displayName}</dd>
            <dt className="text-steel">{t("cust.lang")}</dt><dd>{t(c.preferredLocale === "fa" ? "lang.name.fa" : "lang.name.en")}</dd>
            <dt className="text-steel">{t("cd.timezone")}</dt><dd>{c.timezone}</dd>
            <dt className="text-steel">{t("rp.bestTime")}</dt><dd>{c.profile?.contactTimePref ?? "—"}</dd>
          </dl>
        </Panel>
        <Panel title={t("cd.identities")}>
          <ul className="ledger-rows">{c.identities.map((i) => <li key={i.value} className="flex items-center justify-between py-1"><span><span className="text-meta text-steel">{i.type}</span> <span className="num" dir="ltr">{i.value}</span>{i.isPrimary && <span className="ms-1 text-caption text-steel">{t("cd.primary")}</span>}</span>{i.verifiedAt ? <span className="text-meta text-success">{t("cd.verifiedOn", { d: fmtDate(i.verifiedAt) })}</span> : <StateChip value="UNVERIFIED" className="border-danger text-danger" />}</li>)}</ul>
        </Panel>
        <Panel title={t("cd.travellers")} className="lg:col-span-2">
          {!c.travellers.length ? <Empty>{t("cd.noTravellers")}</Empty> : (
            <>
            <ul className="space-y-2 md:hidden" data-testid="traveller-cards">
              {c.travellers.map((x) => (
                <li key={x.id} className="rounded-xl border border-rule bg-surface-raised p-3">
                  <p className="flex items-center justify-between gap-2 font-medium"><span>{x.title} {x.givenNames} {x.surname}</span>{x.document && <StateChip value={x.verification.status} />}</p>
                  {x.nameFa && <p className="font-fa" dir="rtl">{x.nameFa}</p>}
                  <p className="text-steel">{fmtDate(x.dateOfBirth)} · <Country code={x.nationality} /></p>
                  {x.document && <p className="num mt-1 text-meta">{revealed[x.id] ?? `•••••${x.document.last4}`} · <Country code={x.document.issuingCountry} /> · {t("cd.exp", { d: x.document.expiryDate })}</p>}
                  {x.document && can("customer.read.documents") && !revealed[x.id] && <button type="button" className="mt-1 min-h-8 font-medium text-link hover:underline" onClick={() => reveal.mutate(x.id)}>{t("cd.reveal")}</button>}
                </li>
              ))}
            </ul>
            <TableScroll className="hidden md:block"><table className="w-full bg-surface-raised">
              <thead><tr className="border-b border-rule">{(["cd.c.name", "cd.c.persian", "cd.c.born", "cd.c.nationality", "cd.c.verification", "cd.c.document", ""] as const).map((h, i) => <th key={i} className="cap px-2 py-1 text-start font-normal">{h && t(h)}</th>)}</tr></thead>
              <tbody>{c.travellers.map((x) => <tr key={x.id} className="border-b border-rule/70"><td className="px-2 py-1">{x.title} {x.givenNames} {x.surname}</td><td className="font-fa px-2 py-1" dir="rtl">{x.nameFa ?? "—"}</td><td className="px-2 py-1">{fmtDate(x.dateOfBirth)}</td><td className="px-2 py-1"><Country code={x.nationality} /></td><td className="px-2 py-1">{x.document ? <StateChip value={x.verification.status} /> : "—"}</td><td className="num px-2 py-1">{x.document ? <>{revealed[x.id] ?? `•••••${x.document.last4}`} · <Country code={x.document.issuingCountry} /> · {t("cd.exp", { d: x.document.expiryDate })}</> : "—"}</td><td className="px-2 py-1">{x.document && can("customer.read.documents") && !revealed[x.id] && <button type="button" className="font-medium text-link hover:underline" onClick={() => reveal.mutate(x.id)}>{t("cd.reveal")}</button>}</td></tr>)}</tbody>
            </table></TableScroll>
            </>
          )}
          <p className="mt-1 text-caption text-steel">{t("cd.opened", { t: fmtDateTime(new Date().toISOString()) })}</p>
        </Panel>
      </div>
      </div>)}
      {invoicing && c && <DirectInvoiceDialog customer={{ id, name: c.displayName }} onClose={() => setInvoicing(false)} onSaved={(iid) => { setInvoicing(false); router.push(`/invoices/${iid}`) }} />}
      {assigning && <AssignServiceDialog customerId={id} travellers={c?.travellers ?? []} onOpenChange={(o) => !o && setAssigning(false)} />}
    </div>
  )
}

export default function CustomerPage() { return <Suspense><Customer /></Suspense> }
