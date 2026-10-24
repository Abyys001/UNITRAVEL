"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"

import type { TravellerView } from "@unitravel/contracts"

import { BentoGrid, BentoTile, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { Empty, Loading, PageHead, Panel, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
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
  const ref = useSearchParams().get("ref") ?? undefined
  const { can } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<Context>(`/v1/admin/customers/${id}`) })
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const reveal = useAct((tid: string) => api<{ number: string }>(`/v1/admin/customers/travellers/${tid}/reveal-document`, { body: { ref } }).then((r) => ({ tid, n: r.number })), { onDone: ({ tid, n }) => setRevealed((x) => ({ ...x, [tid]: n })) })
  if (q.error) return <div className="p-5"><TileError message={errText(q.error)} onRetry={() => void q.refetch()} /></div>
  if (!q.data) return <><Loading /><ListSkeleton rows={5} /></>
  const c = q.data
  return (
    <div>
      <PageHead kicker={<>Customer context{ref && <> · from <Link className="num hover:underline" href={ref.startsWith("UT-C-") ? `/cargo/${ref}` : `/requests/${ref}`}>{ref}</Link></>}</>} title={<span dir="auto">{c.profile?.givenNamesLatin ? `${c.profile.givenNamesLatin} ${c.profile.surnameLatin ?? ""}` : c.displayName}</span>}>
        {c.profile?.nameFa && <span className="font-fa text-lg" dir="rtl" lang="fa">{c.profile.nameFa}</span>}
      </PageHead>
      <BentoGrid className="px-5 pt-4 pb-2 max-sm:grid-cols-2 max-sm:gap-2" data-testid="case-summary">
        <BentoTile size="s" title={t("cust.verified")}><p className="num text-[22px] leading-tight font-semibold">{c.identities.filter((i) => i.verifiedAt).length}<span className="text-[13px] font-normal text-steel"> / {c.identities.length}</span></p>{c.identities.some((i) => !i.verifiedAt) && <p className="mt-1 text-[12px] font-medium text-danger">Unverified identity on file</p>}</BentoTile>
        <BentoTile size="s" title={t("cust.travellers")}><p className="num text-[22px] leading-tight font-semibold">{c.travellers.length}</p></BentoTile>
        <BentoTile size="s" title={t("cust.docs")}>
          <p className="num text-[22px] leading-tight font-semibold">{c.travellers.filter((x) => x.document).length}</p>
          <p className="mt-1 flex flex-wrap gap-1">{c.travellers.filter((x) => x.document).map((x) => <StateChip key={x.id} value={x.verification.status} />)}</p>
        </BentoTile>
        <BentoTile size="s" title={t("cust.lang")}><p className="font-medium">{c.preferredLocale === "fa" ? "Persian" : "English"}</p><p className="mt-1 text-[12px] text-steel">{c.timezone}</p></BentoTile>
      </BentoGrid>
      <div className="grid gap-x-8 px-5 lg:grid-cols-2">
        <Panel title="Profile">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
            <dt className="text-steel">Display name</dt><dd dir="auto">{c.displayName}</dd>
            <dt className="text-steel">Language</dt><dd>{c.preferredLocale === "fa" ? "Persian" : "English"}</dd>
            <dt className="text-steel">Time zone</dt><dd>{c.timezone}</dd>
            <dt className="text-steel">Best time to call</dt><dd>{c.profile?.contactTimePref ?? "—"}</dd>
          </dl>
        </Panel>
        <Panel title="Verified identities">
          <ul className="ledger-rows">{c.identities.map((i) => <li key={i.value} className="flex items-center justify-between py-1"><span><span className="font-mono text-[11px] text-steel">{i.type}</span> <span className="num" dir="ltr">{i.value}</span>{i.isPrimary && <span className="ms-1 text-[11px] text-steel">primary</span>}</span>{i.verifiedAt ? <span className="text-[12px] text-success">verified {fmtDate(i.verifiedAt)}</span> : <Tag value="UNVERIFIED" className="border-danger text-danger" />}</li>)}</ul>
        </Panel>
        <Panel title="Travellers" className="lg:col-span-2">
          {!c.travellers.length ? <Empty>No saved travellers.</Empty> : (
            <>
            <ul className="space-y-2 md:hidden" data-testid="traveller-cards">
              {c.travellers.map((x) => (
                <li key={x.id} className="rounded-xl border border-rule bg-surface-raised p-3">
                  <p className="flex items-center justify-between gap-2 font-medium"><span>{x.title} {x.givenNames} {x.surname}</span>{x.document && <StateChip value={x.verification.status} />}</p>
                  {x.nameFa && <p className="font-fa" dir="rtl">{x.nameFa}</p>}
                  <p className="text-steel">{fmtDate(x.dateOfBirth)} · {x.nationality}</p>
                  {x.document && <p className="num mt-1 text-[12px]">{revealed[x.id] ?? `•••••${x.document.last4}`} · {x.document.issuingCountry} · exp {x.document.expiryDate}</p>}
                  {x.document && can("customer.read.documents") && !revealed[x.id] && <button type="button" className="mt-1 min-h-8 text-orange-700 underline" onClick={() => reveal.mutate(x.id)}>Reveal (logged)</button>}
                </li>
              ))}
            </ul>
            <TableScroll className="hidden md:block"><table className="w-full bg-surface-raised">
              <thead><tr className="border-b border-rule">{["Name", "Persian", "Born", "Nationality", "Verification", "Document", ""].map((h) => <th key={h} className="cap px-2 py-1 text-start font-normal">{h}</th>)}</tr></thead>
              <tbody>{c.travellers.map((t) => <tr key={t.id} className="border-b border-rule/70"><td className="px-2 py-1">{t.title} {t.givenNames} {t.surname}</td><td className="font-fa px-2 py-1" dir="rtl">{t.nameFa ?? "—"}</td><td className="px-2 py-1">{fmtDate(t.dateOfBirth)}</td><td className="px-2 py-1">{t.nationality}</td><td className="px-2 py-1">{t.document ? <Tag value={t.verification.status} /> : "—"}</td><td className="num px-2 py-1">{t.document ? `${revealed[t.id] ?? `•••••${t.document.last4}`} · ${t.document.issuingCountry} · exp ${t.document.expiryDate}` : "—"}</td><td className="px-2 py-1">{t.document && can("customer.read.documents") && !revealed[t.id] && <button type="button" className="text-orange-700 underline" onClick={() => reveal.mutate(t.id)}>Reveal (logged)</button>}</td></tr>)}</tbody>
            </table></TableScroll>
            </>
          )}
          <p className="mt-1 text-[11px] text-steel">Opened {fmtDateTime(new Date().toISOString())}. Every reveal records who, when and for which reference.</p>
        </Panel>
      </div>
    </div>
  )
}

export default function CustomerPage() { return <Suspense><Customer /></Suspense> }
