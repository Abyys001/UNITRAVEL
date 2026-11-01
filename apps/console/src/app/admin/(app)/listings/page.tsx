"use client"

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { LISTING_STATUSES, LISTING_VERTICALS, type ListingStatus, type ListingVertical, type StaffListingView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { codeLabel, CURRENCIES, localInput } from "@/components/club"
import { useConfirm } from "@/components/confirm"
import { Chips, ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { FormDialog } from "@/components/form-dialog"
import { Arrow, Field, PageHead, RouteText } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, fmtDateTime, money, toMajor, toMinor } from "@/lib/format"
import { useDebounced } from "@/lib/hooks"
import { useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"

/**
 * Curated listings (ADR-0021): bus, train and stay rows that staff write and publish. Every public item is labelled
 * indicative ("confirmed on quote"); a price is stored only when staff mark it quoted. `/v1/admin/listings`, `listings.write`.
 */

const STATUS_TONE = { DRAFT: "neutral", PUBLISHED: "ok", ARCHIVED: "warn" } as const

interface Draft {
  vertical: ListingVertical; titleEn: string; titleFa: string; summaryEn: string; summaryFa: string; fromPlace: string; toPlace: string; operator: string
  priceQuoted: boolean; amount: string; currency: string; validUntil: string; sortOrder: string
}
const blank = (): Draft => ({ vertical: "BUS", titleEn: "", titleFa: "", summaryEn: "", summaryFa: "", fromPlace: "", toPlace: "", operator: "", priceQuoted: false, amount: "", currency: "GBP", validUntil: "", sortOrder: "100" })
const fromRow = (r: StaffListingView): Draft => ({
  vertical: r.vertical, titleEn: r.title.en, titleFa: r.title.fa, summaryEn: r.summary.en, summaryFa: r.summary.fa, fromPlace: r.fromPlace ?? "", toPlace: r.toPlace, operator: r.operator ?? "",
  priceQuoted: r.priceQuoted, amount: r.price ? toMajor(r.price.amountMinor, r.price.currency) : "", currency: r.price?.currency ?? "GBP", validUntil: r.validUntil ? localInput(new Date(r.validUntil)) : "", sortOrder: String(r.sortOrder),
})

function ListingDialog({ row, onOpenChange }: { row: StaffListingView | null; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [d, setD] = useState<Draft>(() => (row ? fromRow(row) : blank()))
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const stay = d.vertical === "STAY"
  const submit = async () => {
    const body = {
      vertical: d.vertical, title: { en: d.titleEn.trim(), fa: d.titleFa.trim() }, summary: { en: d.summaryEn.trim(), fa: d.summaryFa.trim() },
      fromPlace: stay ? null : d.fromPlace.trim() || null, toPlace: d.toPlace.trim(), operator: d.operator.trim() || null,
      priceQuoted: d.priceQuoted, price: d.priceQuoted ? { amountMinor: toMinor(d.amount.replace(",", "."), d.currency), currency: d.currency } : null,
      validUntil: d.validUntil ? new Date(d.validUntil).toISOString() : null, sortOrder: Number(d.sortOrder),
    }
    if (row) await api(`/v1/admin/listings/${row.id}`, { method: "PATCH", body: { ...body, version: row.version } })
    else await api("/v1/admin/listings", { body })
    await qc.invalidateQueries({ queryKey: ["listings"] })
  }
  return (
    <FormDialog open onOpenChange={onOpenChange} wide title={row ? t("ls.edit") : t("ls.new")} description={t("ls.dialog.desc")} submitLabel={row ? t("ls.save") : t("ls.create")} onSubmit={submit} testId="dlg-listing">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("ls.vertical")}>
          <NativeSelect className="field-input" value={d.vertical} onChange={(e) => set("vertical", e.target.value as ListingVertical)} data-testid="listing-vertical">{LISTING_VERTICALS.map((v) => <option key={v} value={v}>{codeLabel(t, "ls.v", v)}</option>)}</NativeSelect>
        </Field>
        <Field label={t("ls.operator")}><input className="field-input" value={d.operator} onChange={(e) => set("operator", e.target.value)} minLength={2} maxLength={80} dir="auto" /></Field>
        <Field label={t("ls.sort")} hint={t("ls.sort.hint")}><input type="number" className="field-input num" value={d.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} min={0} max={10000} required dir="ltr" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${t("ls.title")} (English)`}><input className="field-input" value={d.titleEn} onChange={(e) => set("titleEn", e.target.value)} required minLength={2} maxLength={120} dir="ltr" lang="en" data-testid="listing-title-en" /></Field>
        <Field label={`${t("ls.title")} (فارسی)`}><input className="field-input font-fa" value={d.titleFa} onChange={(e) => set("titleFa", e.target.value)} required minLength={2} maxLength={120} dir="rtl" lang="fa" data-testid="listing-title-fa" /></Field>
        <Field label={`${t("ls.summary")} (English)`}><textarea className="field-input min-h-16" value={d.summaryEn} onChange={(e) => set("summaryEn", e.target.value)} maxLength={400} dir="ltr" lang="en" /></Field>
        <Field label={`${t("ls.summary")} (فارسی)`}><textarea className="field-input min-h-16 font-fa" value={d.summaryFa} onChange={(e) => set("summaryFa", e.target.value)} maxLength={400} dir="rtl" lang="fa" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {!stay && <Field label={t("ls.from")}><input className="field-input" value={d.fromPlace} onChange={(e) => set("fromPlace", e.target.value)} required minLength={2} maxLength={80} dir="auto" /></Field>}
        <Field label={stay ? t("ls.place") : t("ls.to")}><input className="field-input" value={d.toPlace} onChange={(e) => set("toPlace", e.target.value)} required minLength={2} maxLength={80} dir="auto" /></Field>
        <Field label={t("ls.validUntil")} hint={t("ls.validUntil.hint")}><input type="datetime-local" className="field-input" value={d.validUntil} onChange={(e) => set("validUntil", e.target.value)} /></Field>
      </div>
      <fieldset className="rounded-lg border border-rule p-3">
        <legend className="px-1 text-meta font-medium text-ink">{t("ls.price")}</legend>
        <label className="flex min-h-control cursor-pointer items-center gap-2 pointer-coarse:min-h-11"><input type="checkbox" checked={d.priceQuoted} onChange={(e) => set("priceQuoted", e.target.checked)} data-testid="listing-quoted" /><span>{t("ls.quoted")}</span></label>
        <p className="text-caption text-steel">{d.priceQuoted ? t("ls.quoted.on") : t("ls.quoted.off")}</p>
        {d.priceQuoted && (
          <div className="mt-2 grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label={t("q.currency")}><NativeSelect className="field-input" value={d.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
            <Field label={`${t("q.amount")} (${d.currency})`}><input className="field-input num" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={d.amount} onChange={(e) => set("amount", e.target.value)} required placeholder="0.00" dir="ltr" data-testid="listing-amount" /></Field>
          </div>
        )}
      </fieldset>
    </FormDialog>
  )
}

function Listings() {
  const t = useT()
  const [locale] = useLocale()
  const qc = useQueryClient()
  const { ask, dialog } = useConfirm()
  const [vertical, setVertical] = useState("")
  const [status, setStatus] = useState("")
  const [search, setSearch] = useState("")
  const q = useDebounced(search.trim(), 300)
  const [editing, setEditing] = useState<StaffListingView | "new" | null>(null)
  const list = useInfiniteQuery({
    queryKey: ["listings", "list", vertical, status, q],
    queryFn: ({ pageParam }) => {
      const u = new URLSearchParams({ limit: "50" })
      if (vertical) u.set("vertical", vertical)
      if (status) u.set("status", status)
      if (q) u.set("q", q)
      if (pageParam) u.set("cursor", pageParam)
      return api<{ items: StaffListingView[]; nextCursor: string | null }>(`/v1/admin/listings?${u.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data])
  const setState = async (r: StaffListingView, next: ListingStatus) => {
    try { await api(`/v1/admin/listings/${r.id}`, { method: "PATCH", body: { status: next, version: r.version } }); await qc.invalidateQueries({ queryKey: ["listings"] }) } catch (e) { await qc.invalidateQueries({ queryKey: ["listings"] }); throw e }
  }
  const change = (r: StaffListingView, next: ListingStatus) => {
    const title = locale === "fa" ? r.title.fa : r.title.en
    if (next === "PUBLISHED") ask({ title: t("ls.publish.title", { n: title }), description: t("ls.publish.body"), label: t("ls.publish"), run: () => setState(r, next) })
    else if (next === "ARCHIVED") ask({ title: t("ls.archive.title", { n: title }), description: t("ls.archive.body"), label: t("ls.archive"), destructive: true, run: () => setState(r, next) })
    else void setState(r, next).then(() => toast.success(t("ls.draft.done"))).catch((e: unknown) => toast.error(errText(e)))
  }
  const name = (r: StaffListingView) => (locale === "fa" ? r.title.fa : r.title.en)
  const other = (r: StaffListingView) => (locale === "fa" ? r.title.en : r.title.fa)
  const route = (r: StaffListingView) => r.fromPlace ? <RouteText>{r.fromPlace}</RouteText> : null
  const price = (r: StaffListingView) => r.price ? <span className="num font-medium">{money(r.price)}</span> : <span className="text-steel">{t("ls.noPrice")}</span>
  const actions = (r: StaffListingView) => (
    <span className="flex flex-wrap items-center gap-1.5">
      <Button size="xs" variant="outline" onClick={() => setEditing(r)}>{t("ls.edit")}</Button>
      {r.status !== "PUBLISHED" && <Button size="xs" variant="outline" onClick={() => change(r, "PUBLISHED")}>{t("ls.publish")}</Button>}
      {r.status === "PUBLISHED" && <Button size="xs" variant="outline" onClick={() => change(r, "DRAFT")}>{t("ls.unpublish")}</Button>}
      {r.status !== "ARCHIVED" && <Button size="xs" variant="ghost" className="text-danger" onClick={() => change(r, "ARCHIVED")}>{t("ls.archive")}</Button>}
    </span>
  )
  const statusChip = (s: string) => <StatusChip tone={STATUS_TONE[s as keyof typeof STATUS_TONE] ?? "neutral"}><span data-status={s}>{codeLabel(t, "ls.s", s)}</span></StatusChip>
  const more = list.hasNextPage && <div className="flex justify-center border-t border-rule p-3"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></div>
  return (
    <ListPage>
      {dialog}
      <PageHead title={t("ls.title.page")}><Button size="sm" onClick={() => setEditing("new")} data-testid="new-listing"><Plus aria-hidden />{t("ls.new")}</Button></PageHead>
      <p className="px-4 pb-3 text-meta text-steel md:px-6">{t("ls.note")}</p>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("ls.search")} count={list.data && !list.hasNextPage ? rows.length : undefined}>
        <Chips label={t("ls.vertical")} value={vertical} options={[{ value: "", label: t("pg.all") }, ...LISTING_VERTICALS.map((v) => ({ value: v as string, label: codeLabel(t, "ls.v", v) }))]} onChange={setVertical} />
        <Chips label={t("pg.c.status")} value={status} options={[{ value: "", label: t("pg.all") }, ...LISTING_STATUSES.map((s) => ({ value: s as string, label: codeLabel(t, "ls.s", s) }))]} onChange={setStatus} />
      </Toolbar>
      {list.error ? <div className="px-4 py-3 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={5} className="px-4 md:px-6" /> : !rows.length ? <EmptyState title={t("ls.none")} hint={t("ls.none.hint")} action={<Button size="sm" onClick={() => setEditing("new")}>{t("ls.new")}</Button>} /> : (
        <>
          <ul className="space-y-2 px-4 pb-4 md:px-6 xl:hidden" data-testid="listing-cards">
            {rows.map((r) => (
              <li key={r.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
                <p className="flex items-center justify-between gap-2"><span className="text-meta text-steel">{codeLabel(t, "ls.v", r.vertical)}</span>{statusChip(r.status)}</p>
                <p className="mt-1 font-medium" dir="auto">{name(r)}</p>
                <p className="text-meta text-steel" dir="auto">{other(r)}</p>
                <p className="mt-1 text-steel">{route(r)}{route(r) && <> <Arrow /> </>}<span dir="auto">{r.toPlace}</span>{r.operator && <> · <span dir="auto">{r.operator}</span></>}<span className="block text-caption">{t("ls.sort")}: <span className="num">{r.sortOrder}</span></span></p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-meta">{price(r)}{r.validUntil && <span className="text-steel">{t("ls.until", { d: fmtDate(r.validUntil) })}</span>}</p>
                <div className="mt-2.5">{actions(r)}</div>
              </li>
            ))}
            {more && <li>{more}</li>}
          </ul>
          <ListCard fill className="hidden xl:flex">
            <TableScroll label={t("ls.title.page")}>
              <table className={tableClass} data-testid="listings">
                <thead><tr><th>{t("ls.title")}</th><th>{t("ls.route")}</th><th>{t("ls.price")}</th><th>{t("pg.c.status")}</th><th>{t("ls.validUntil")}</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="max-w-72"><span className="block truncate font-medium" dir="auto">{name(r)}</span><span className="block truncate text-caption text-steel" dir="auto">{other(r)}</span></td>
                      <td className="whitespace-nowrap">{route(r)}{route(r) && <> <Arrow /> </>}<span dir="auto">{r.toPlace}</span><span className="block text-caption text-steel">{codeLabel(t, "ls.v", r.vertical)}{r.operator && <> · <span dir="auto">{r.operator}</span></>}</span></td>
                      <td className="whitespace-nowrap">{price(r)}</td>
                      <td className="whitespace-nowrap">{statusChip(r.status)}</td>
                      <td className="num whitespace-nowrap text-steel" title={r.validUntil ? fmtDateTime(r.validUntil) : undefined}>{r.validUntil ? fmtDate(r.validUntil) : "—"}</td>
                      <td className="whitespace-nowrap">{actions(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            {more}
          </ListCard>
        </>
      )}
      {editing && <ListingDialog row={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />}
    </ListPage>
  )
}

export default function ListingsPage() { return <Listings /> }
