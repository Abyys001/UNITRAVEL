"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"

import type { TravellerView } from "@unitravel/contracts"

import { Empty, ErrorLine, Loading, PageHead, Panel, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
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
  const ref = useSearchParams().get("ref") ?? undefined
  const { can } = useSession()
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<Context>(`/v1/admin/customers/${id}`) })
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const reveal = useAct((tid: string) => api<{ number: string }>(`/v1/admin/customers/travellers/${tid}/reveal-document`, { body: { ref } }).then((r) => ({ tid, n: r.number })), { onDone: ({ tid, n }) => setRevealed((x) => ({ ...x, [tid]: n })) })
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const c = q.data
  return (
    <div>
      <PageHead kicker={<>Customer context{ref && <> · from <Link className="num hover:underline" href={ref.startsWith("UT-C-") ? `/cargo/${ref}` : `/requests/${ref}`}>{ref}</Link></>}</>} title={<span dir="auto">{c.profile?.givenNamesLatin ? `${c.profile.givenNamesLatin} ${c.profile.surnameLatin ?? ""}` : c.displayName}</span>}>
        {c.profile?.nameFa && <span className="font-fa text-lg" dir="rtl" lang="fa">{c.profile.nameFa}</span>}
      </PageHead>
      <div className="grid gap-x-8 px-5 lg:grid-cols-2">
        <Panel title="Profile">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
            <dt className="text-slate">Display name</dt><dd dir="auto">{c.displayName}</dd>
            <dt className="text-slate">Language</dt><dd>{c.preferredLocale === "fa" ? "Persian" : "English"}</dd>
            <dt className="text-slate">Time zone</dt><dd>{c.timezone}</dd>
            <dt className="text-slate">Best time to call</dt><dd>{c.profile?.contactTimePref ?? "—"}</dd>
          </dl>
        </Panel>
        <Panel title="Verified identities">
          <ul className="ledger-rows">{c.identities.map((i) => <li key={i.value} className="flex items-center justify-between py-1"><span><span className="font-mono text-[11px] text-slate">{i.type}</span> <span className="num" dir="ltr">{i.value}</span>{i.isPrimary && <span className="ms-1 text-[11px] text-slate">primary</span>}</span>{i.verifiedAt ? <span className="text-[12px] text-moss">verified {fmtDate(i.verifiedAt)}</span> : <Tag value="UNVERIFIED" className="border-brick text-brick" />}</li>)}</ul>
        </Panel>
        <Panel title="Travellers" className="lg:col-span-2">
          {!c.travellers.length ? <Empty>No saved travellers.</Empty> : (
            <table className="w-full bg-white">
              <thead><tr className="border-b border-rule">{["Name", "Persian", "Born", "Nationality", "Document", ""].map((h) => <th key={h} className="cap px-2 py-1 text-start font-normal">{h}</th>)}</tr></thead>
              <tbody>{c.travellers.map((t) => <tr key={t.id} className="border-b border-rule/70"><td className="px-2 py-1">{t.title} {t.givenNames} {t.surname}</td><td className="font-fa px-2 py-1" dir="rtl">{t.nameFa ?? "—"}</td><td className="px-2 py-1">{fmtDate(t.dateOfBirth)}</td><td className="px-2 py-1">{t.nationality}</td><td className="num px-2 py-1">{t.document ? `${revealed[t.id] ?? `•••••${t.document.last4}`} · ${t.document.issuingCountry} · exp ${t.document.expiryDate}` : "—"}</td><td className="px-2 py-1">{t.document && can("customer.read.documents") && !revealed[t.id] && <button type="button" className="text-copper-700 underline" onClick={() => reveal.mutate(t.id)}>Reveal (logged)</button>}</td></tr>)}</tbody>
            </table>
          )}
          <p className="mt-1 text-[11px] text-slate">Opened {fmtDateTime(new Date().toISOString())}. Every reveal records who, when and for which reference.</p>
        </Panel>
      </div>
    </div>
  )
}

export default function CustomerPage() { return <Suspense><Customer /></Suspense> }
