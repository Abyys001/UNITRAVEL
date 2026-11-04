"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { INVOICE_LINE_TYPES, type InvoiceLineType, type ServiceCatalogItem } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { CURRENCIES } from "@/components/club"
import { useConfirm } from "@/components/confirm"
import { ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { FormDialog } from "@/components/form-dialog"
import { Field, PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { money, toMajor, toMinor } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"
import { useSession } from "@/lib/session"

/**
 * Add-on service catalogue (STAGE-26). Staff define what can be attached to a quote or ticked by a customer. The default
 * price is staff-only unless "show price to customers" is on. `/v1/admin/services-catalog`, `service_catalog.manage`.
 */

interface Draft {
  code: string; nameEn: string; nameFa: string; descriptionEn: string; descriptionFa: string; lineType: InvoiceLineType
  amount: string; currency: string; perPassenger: boolean; showPriceToCustomer: boolean; active: boolean
}
const blank = (): Draft => ({ code: "", nameEn: "", nameFa: "", descriptionEn: "", descriptionFa: "", lineType: "OTHER", amount: "", currency: "GBP", perPassenger: false, showPriceToCustomer: false, active: true })
const fromRow = (r: ServiceCatalogItem): Draft => ({
  code: r.code, nameEn: r.nameEn, nameFa: r.nameFa, descriptionEn: r.descriptionEn ?? "", descriptionFa: r.descriptionFa ?? "", lineType: r.lineType,
  amount: toMajor(r.defaultPriceMinor, r.currency), currency: r.currency, perPassenger: r.perPassenger, showPriceToCustomer: r.showPriceToCustomer, active: r.active,
})

function ItemDialog({ row, onOpenChange }: { row: ServiceCatalogItem | null; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [d, setD] = useState<Draft>(() => (row ? fromRow(row) : blank()))
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const submit = async () => {
    const body = {
      nameEn: d.nameEn.trim(), nameFa: d.nameFa.trim(), descriptionEn: d.descriptionEn.trim() || undefined, descriptionFa: d.descriptionFa.trim() || undefined,
      lineType: d.lineType, defaultPriceMinor: toMinor(d.amount.replace(",", "."), d.currency), currency: d.currency, perPassenger: d.perPassenger, showPriceToCustomer: d.showPriceToCustomer, active: d.active,
    }
    if (row) await api(`/v1/admin/services-catalog/${row.id}`, { method: "PATCH", body })
    else await api("/v1/admin/services-catalog", { body: { ...body, code: d.code.trim().toUpperCase() } })
    await qc.invalidateQueries({ queryKey: ["svc-catalog"] })
  }
  return (
    <FormDialog open onOpenChange={onOpenChange} wide title={row ? t("svcat.edit") : t("svcat.new")} description={t("svcat.dialog.desc")} submitLabel={row ? t("svcat.save") : t("svcat.create")} onSubmit={submit} testId="dlg-catalog-item">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("svcat.code")} hint={row ? t("svcat.code.locked") : t("svcat.code.hint")}>
          <input className="field-input font-mono uppercase" value={d.code} onChange={(e) => set("code", e.target.value.toUpperCase())} pattern="[A-Z0-9_]{2,32}" required disabled={!!row} dir="ltr" data-testid="catalog-code" />
        </Field>
        <Field label={t("svcat.lineType")}>
          <NativeSelect className="field-input" value={d.lineType} onChange={(e) => set("lineType", e.target.value as InvoiceLineType)} data-testid="catalog-linetype">{INVOICE_LINE_TYPES.filter((x) => x !== "DISCOUNT").map((x) => <option key={x} value={x}>{t(`invd.type.${x}`)}</option>)}</NativeSelect>
        </Field>
        <Field label={`${t("svcat.name")} (English)`}><input className="field-input" value={d.nameEn} onChange={(e) => set("nameEn", e.target.value)} required maxLength={120} dir="ltr" lang="en" data-testid="catalog-name-en" /></Field>
        <Field label={`${t("svcat.name")} (فارسی)`}><input className="field-input font-fa" value={d.nameFa} onChange={(e) => set("nameFa", e.target.value)} required maxLength={120} dir="rtl" lang="fa" data-testid="catalog-name-fa" /></Field>
        <Field label={`${t("svcat.desc")} (English)`}><textarea className="field-input min-h-16" value={d.descriptionEn} onChange={(e) => set("descriptionEn", e.target.value)} maxLength={1000} dir="ltr" lang="en" /></Field>
        <Field label={`${t("svcat.desc")} (فارسی)`}><textarea className="field-input min-h-16 font-fa" value={d.descriptionFa} onChange={(e) => set("descriptionFa", e.target.value)} maxLength={1000} dir="rtl" lang="fa" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label={t("q.currency")}><NativeSelect className="field-input" value={d.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
        <Field label={`${t("svcat.price")} (${d.currency})`}><input className="field-input num" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={d.amount} onChange={(e) => set("amount", e.target.value)} required placeholder="0.00" dir="ltr" data-testid="catalog-amount" /></Field>
      </div>
      <div className="grid gap-1">
        <label className="flex min-h-control cursor-pointer items-center gap-2 pointer-coarse:min-h-11"><input type="checkbox" checked={d.perPassenger} onChange={(e) => set("perPassenger", e.target.checked)} /><span>{t("svcat.perPassenger")}</span></label>
        <label className="flex min-h-control cursor-pointer items-center gap-2 pointer-coarse:min-h-11"><input type="checkbox" checked={d.showPriceToCustomer} onChange={(e) => set("showPriceToCustomer", e.target.checked)} data-testid="catalog-show-price" /><span>{t("svcat.showPrice")}</span></label>
        <p className="text-caption text-steel">{d.showPriceToCustomer ? t("svcat.showPrice.on") : t("svcat.showPrice.off")}</p>
        <label className="flex min-h-control cursor-pointer items-center gap-2 pointer-coarse:min-h-11"><input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /><span>{t("svcat.active")}</span></label>
      </div>
    </FormDialog>
  )
}

function Catalogue() {
  const t = useT()
  const [locale] = useLocale()
  const qc = useQueryClient()
  const { can } = useSession()
  const { ask, dialog } = useConfirm()
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<ServiceCatalogItem | "new" | null>(null)
  const list = useQuery({ queryKey: ["svc-catalog", "admin"], queryFn: () => api<ServiceCatalogItem[]>("/v1/admin/services-catalog"), enabled: can("service_catalog.manage") })
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (list.data ?? []).filter((r) => !q || [r.code, r.nameEn, r.nameFa].some((x) => x.toLowerCase().includes(q)))
  }, [list.data, search])
  const name = (r: ServiceCatalogItem) => (locale === "fa" ? r.nameFa : r.nameEn)
  const other = (r: ServiceCatalogItem) => (locale === "fa" ? r.nameEn : r.nameFa)
  const setActive = async (r: ServiceCatalogItem, active: boolean) => {
    try { await api(`/v1/admin/services-catalog/${r.id}`, { method: "PATCH", body: { active } }); await qc.invalidateQueries({ queryKey: ["svc-catalog"] }) } catch (e) { toast.error(errText(e)) }
  }
  const toggle = (r: ServiceCatalogItem) => {
    if (r.active) ask({ title: t("svcat.deactivate.title", { n: name(r) }), description: t("svcat.deactivate.body"), label: t("svcat.deactivate"), destructive: true, run: () => setActive(r, false) })
    else void setActive(r, true)
  }
  const actions = (r: ServiceCatalogItem) => (
    <span className="flex flex-wrap items-center gap-1.5">
      <Button size="xs" variant="outline" onClick={() => setEditing(r)}>{t("svcat.edit")}</Button>
      <Button size="xs" variant="ghost" className={r.active ? "text-danger" : undefined} onClick={() => toggle(r)}>{r.active ? t("svcat.deactivate") : t("svcat.activate")}</Button>
    </span>
  )
  const state = (r: ServiceCatalogItem) => <StatusChip tone={r.active ? "ok" : "neutral"}><span data-status={r.active ? "ACTIVE" : "INACTIVE"}>{r.active ? t("svcat.s.active") : t("svcat.s.inactive")}</span></StatusChip>
  const price = (r: ServiceCatalogItem) => <span className="num font-medium">{money({ amountMinor: r.defaultPriceMinor, currency: r.currency })}{r.perPassenger && <span className="text-caption font-normal text-steel"> {t("svcat.perPax")}</span>}</span>
  if (!can("service_catalog.manage")) return <ListPage><PageHead title={t("svcat.title.page")} /><EmptyState title={t("svcat.forbidden")} /></ListPage>
  return (
    <ListPage>
      {dialog}
      <PageHead title={t("svcat.title.page")}><Button size="sm" onClick={() => setEditing("new")} data-testid="new-catalog-item"><Plus aria-hidden />{t("svcat.new")}</Button></PageHead>
      <p className="px-4 pb-3 text-meta text-steel md:px-6">{t("svcat.note")}</p>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("svcat.search")} count={list.data ? rows.length : undefined} />
      {list.error ? <div className="px-4 py-3 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={5} className="px-4 md:px-6" /> : !rows.length ? <EmptyState title={t("svcat.none")} hint={t("svcat.none.hint")} action={<Button size="sm" onClick={() => setEditing("new")}>{t("svcat.new")}</Button>} /> : (
        <>
          <ul className="space-y-2 px-4 pb-4 md:px-6 xl:hidden" data-testid="catalog-cards">
            {rows.map((r) => (
              <li key={r.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
                <p className="flex items-center justify-between gap-2"><span className="num text-meta text-steel">{r.code}</span>{state(r)}</p>
                <p className="mt-1 font-medium" dir="auto">{name(r)}</p>
                <p className="text-meta text-steel" dir="auto">{other(r)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-meta">{price(r)}<span className="text-steel">{t(`invd.type.${r.lineType}`)}</span><span className="text-steel">{r.showPriceToCustomer ? t("svcat.priceShown") : t("svcat.priceHidden")}</span></p>
                <div className="mt-2.5">{actions(r)}</div>
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden xl:flex">
            <TableScroll label={t("svcat.title.page")}>
              <table className={tableClass} data-testid="catalog-items">
                <thead><tr><th>{t("svcat.code")}</th><th>{t("svcat.name")}</th><th>{t("svcat.lineType")}</th><th>{t("svcat.price")}</th><th>{t("svcat.customerPrice")}</th><th>{t("pg.c.status")}</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="num whitespace-nowrap">{r.code}</td>
                      <td className="max-w-72"><span className="block truncate font-medium" dir="auto">{name(r)}</span><span className="block truncate text-caption text-steel" dir="auto">{other(r)}</span></td>
                      <td className="whitespace-nowrap">{t(`invd.type.${r.lineType}`)}</td>
                      <td className="whitespace-nowrap">{price(r)}</td>
                      <td className="whitespace-nowrap text-steel">{r.showPriceToCustomer ? t("svcat.priceShown") : t("svcat.priceHidden")}</td>
                      <td className="whitespace-nowrap">{state(r)}</td>
                      <td className="whitespace-nowrap">{actions(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </ListCard>
        </>
      )}
      {editing && <ItemDialog row={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />}
    </ListPage>
  )
}

export default function ServicesCatalogPage() { return <Catalogue /> }
