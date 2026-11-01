"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { type CustomerListPage, directInvoiceTotal, INVOICE_LINE_TYPES, type InvoiceLineType, type StaffInvoice } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@unitravel/ui/components/dialog"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { codeLabel, CURRENCIES } from "@/components/club"
import { Field } from "@/components/ui"
import { api, ApiError, errText } from "@/lib/api"
import { money, toMajor, toMinor } from "@/lib/format"
import { useT } from "@/lib/i18n"

interface Row { key: number; serviceType: InvoiceLineType; description: string; quantity: string; price: string }
let rowKey = 0
const newRow = (): Row => ({ key: ++rowKey, serviceType: "VISA", description: "", quantity: "1", price: "" })
export type InvoiceCustomer = { id: string; name: string }

/** Typed positive; a DISCOUNT line is sent negative, every other line positive (ADR-0028 D4). */
const signedMinor = (r: Row, currency: string) => { const m = Math.abs(toMinor(r.price.replace(",", "."), currency)); return r.serviceType === "DISCOUNT" ? -m : m }

/**
 * Create or edit a direct invoice (ADR-0028). Mounted only while open so every opening starts from the given invoice.
 * "Issue and send" saves, then issues; a compliance hold (409) leaves the saved draft and opens it, where the action
 * reason explains the hold. Amounts are recomputed by the server; the total here is a preview.
 */
export function DirectInvoiceDialog({ customer, invoice, onClose, onSaved }: { customer?: InvoiceCustomer; invoice?: StaffInvoice; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [who, setWho] = useState<InvoiceCustomer | null>(invoice ? { id: invoice.customer.id, name: invoice.customer.name } : customer ?? null)
  const [search, setSearch] = useState("")
  const [currency, setCurrency] = useState<string>(invoice?.currency ?? "GBP")
  const [rows, setRows] = useState<Row[]>(() => invoice
    ? invoice.lines.map((l) => ({ key: ++rowKey, serviceType: l.serviceType ?? "OTHER", description: l.description, quantity: String(l.quantity), price: l.unitAmount ? toMajor(Math.abs(l.unitAmount.amountMinor), invoice.currency) : "" }))
    : [newRow()])
  const [dueDays, setDueDays] = useState(invoice?.dueDays ? String(invoice.dueDays) : "")
  const [notes, setNotes] = useState(invoice?.notes ?? "")
  const [busy, setBusy] = useState<"draft" | "issue" | null>(null)
  const [err, setErr] = useState<ApiError | string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(invoice?.id ?? null)

  const people = useQuery({
    queryKey: ["customers", "picker", search.trim()],
    queryFn: () => api<CustomerListPage>(`/v1/admin/customers?limit=8&q=${encodeURIComponent(search.trim())}`),
    enabled: !who && search.trim().length >= 2,
  })
  const update = (k: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)))
  const total = directInvoiceTotal(rows.map((r) => ({ quantity: Math.max(1, Number(r.quantity) || 1), unitAmountMinor: signedMinor(r, currency) })))
  const fieldErr = (path: string) => (err instanceof ApiError ? err.field(path) : undefined)

  const submit = async (issue: boolean) => {
    if (!who) { setErr(t("invd.customer.required")); return }
    setBusy(issue ? "issue" : "draft"); setErr(null)
    const body = {
      currency,
      lines: rows.map((r) => ({ serviceType: r.serviceType, description: r.description.trim(), quantity: Number(r.quantity), unitAmountMinor: signedMinor(r, currency) })),
      dueDays: dueDays.trim() ? Number(dueDays) : null,
      notes: notes.trim() || null,
    }
    let id = savedId
    try {
      if (id) await api<StaffInvoice>(`/v1/admin/invoices/${id}`, { method: "PUT", body })
      else { id = (await api<StaffInvoice>("/v1/admin/invoices", { body: { customerUserId: who.id, ...body } })).id; setSavedId(id) }
    } catch (e) { setErr(e instanceof ApiError ? e : errText(e)); setBusy(null); return }
    await qc.invalidateQueries({ queryKey: ["invoices"] })
    await qc.invalidateQueries({ queryKey: ["invoice", id] })
    if (!issue) { toast.success(t("invd.saved")); setBusy(null); onSaved(id); return }
    try {
      await api<StaffInvoice>(`/v1/admin/invoices/${id}/issue`, { body: {} })
      await qc.invalidateQueries({ queryKey: ["invoices"] })
      await qc.invalidateQueries({ queryKey: ["invoice", id] })
      toast.success(t("invp.issued")); setBusy(null); onSaved(id)
    } catch (e) {
      // The draft is saved; open it so the reason shows next to the disabled Issue button.
      if (e instanceof ApiError && e.code === "COMPLIANCE_REVIEW_REQUIRED") { toast.error(errText(e)); await qc.invalidateQueries({ queryKey: ["invoice", id] }); setBusy(null); onSaved(id); return }
      setErr(e instanceof ApiError ? e : errText(e)); setBusy(null)
    }
  }

  const general = typeof err === "string" ? err : err ? [err.problem.detail ?? err.problem.title, ...(err.problem.errors ?? []).map((x) => `${x.path}: ${x.message ?? x.code}`)].join(" — ") : null
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto p-5 sm:max-w-3xl" data-testid="dlg-direct-invoice">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-normal">{invoice ? t("invd.edit.title") : t("invd.new.title")}</DialogTitle>
          <DialogDescription className="text-steel">{t("invd.hint")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit((e.nativeEvent as SubmitEvent).submitter?.getAttribute("name") !== "draft") }}>
          <Field label={t("invd.customer")}>
            {who ? (
              <p className="flex items-center justify-between gap-2 rounded-lg border border-rule px-3 py-1.5" data-testid="invoice-customer"><span dir="auto" className="font-medium">{who.name}</span>{!invoice && !customer && <Button type="button" size="xs" variant="ghost" onClick={() => { setWho(null); setSearch("") }}>{t("invd.customer.change")}</Button>}</p>
            ) : (
              <div className="space-y-1">
                <input type="search" className="field-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("invd.customer.search")} dir="auto" autoComplete="off" data-testid="customer-search" />
                {search.trim().length >= 2 && (people.isLoading ? <p className="text-meta text-steel">…</p> : !people.data?.items.length ? <p className="text-meta text-steel">{t("invd.customer.none")}</p> : (
                  <ul className="divide-y divide-rule rounded-lg border border-rule" data-testid="customer-results">
                    {people.data.items.map((c) => (
                      <li key={c.id}><button type="button" className="flex min-h-control w-full items-center justify-between gap-3 px-3 py-1.5 text-start hover:bg-hover pointer-coarse:min-h-11" onClick={() => setWho({ id: c.id, name: c.displayName })}><span dir="auto" className="font-medium">{c.displayName}</span><span className="num text-meta text-steel" dir="ltr">{c.phone ?? c.email ?? ""}</span></button></li>
                    ))}
                  </ul>
                ))}
              </div>
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-[10rem_10rem]">
            <Field label={t("q.currency")}><NativeSelect className="field-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
            <Field label={t("invd.dueDays")} hint={t("invd.dueDays.hint")}><input className="field-input num" type="number" min={1} max={365} step={1} value={dueDays} onChange={(e) => setDueDays(e.target.value)} dir="ltr" data-testid="invoice-due-days" /></Field>
          </div>

          <fieldset className="space-y-2" data-testid="invoice-lines">
            <legend className="mb-1 text-meta font-medium text-ink">{t("invd.lines")}</legend>
            {rows.map((r, i) => (
              <div key={r.key} role="group" aria-label={t("q.line", { n: i + 1 })} className="space-y-1 rounded-lg border border-rule p-3">
                <div className="grid gap-2 sm:grid-cols-[9rem_1fr_5rem_8rem_auto] sm:items-end">
                  <Field label={t("invd.type")}><NativeSelect className="field-input" value={r.serviceType} onChange={(e) => update(r.key, { serviceType: e.target.value as InvoiceLineType })} data-testid="line-type">{INVOICE_LINE_TYPES.map((x) => <option key={x} value={x}>{codeLabel(t, "invd.type", x)}</option>)}</NativeSelect></Field>
                  <Field label={t("invd.description")}><input className="field-input" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} required minLength={2} maxLength={200} dir="auto" data-testid="line-description" /></Field>
                  <Field label={t("invd.qty")}><input className="field-input num" type="number" min={1} max={999} step={1} value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} required dir="ltr" data-testid="line-qty" /></Field>
                  <Field label={t("invd.unit", { c: currency })}><input className="field-input num" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} required placeholder="0.00" dir="ltr" data-testid="line-price" /></Field>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1} aria-label={t("q.remove", { n: i + 1 })} className="text-steel hover:text-danger"><Trash2 aria-hidden /></Button>
                </div>
                {r.serviceType === "DISCOUNT" && <p className="text-caption text-steel">{t("invd.discountHint")}</p>}
                {(["description", "quantity", "unitAmountMinor", "serviceType"] as const).map((f) => { const m = fieldErr(`lines.${i}.${f}`); return m ? <p key={f} role="alert" className="text-caption text-danger">{m}</p> : null })}
              </div>
            ))}
            {rows.length < 50 && <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, newRow()])} data-testid="add-line"><Plus aria-hidden />{t("q.add")}</Button>}
            {fieldErr("lines") && <p role="alert" className="text-caption text-danger">{fieldErr("lines")}</p>}
            <div className="flex items-baseline justify-between gap-3 border-t border-rule pt-3" aria-live="polite">
              <span className="font-medium">{t("svc.total")}</span>
              <output className={cn("num text-lead font-semibold", total <= 0 && "text-danger")} data-testid="invoice-total">{money({ amountMinor: total, currency })}</output>
            </div>
          </fieldset>

          <Field label={t("invd.notes")} hint={t("invd.notes.hint")}><textarea className="field-input min-h-14" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} dir="auto" data-testid="invoice-notes" /></Field>
          {fieldErr("notes") && <p role="alert" className="text-caption text-danger">{fieldErr("notes")}</p>}
          {general && <p role="alert" className="rounded-sm bg-danger-subtle px-2 py-1.5 text-danger" data-testid="invoice-form-error">{general}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={!!busy}>{t("common.cancel")}</Button>
            <Button type="submit" name="draft" variant="outline" size="sm" loading={busy === "draft"} disabled={!!busy} data-testid="save-draft">{t("invd.saveDraft")}</Button>
            <Button type="submit" size="sm" loading={busy === "issue"} disabled={!!busy} data-testid="issue-send">{t("invd.issueSend")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
