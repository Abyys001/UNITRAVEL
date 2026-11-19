"use client"

import { Loader2, Upload } from "lucide-react"
import { useRef, useState } from "react"

import { type BrandColours, DEFAULT_BRAND_COLOURS } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { type Issue, friendlyIssue } from "@/components/schema-form"
import { errText } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { uploadAndScan } from "@/lib/upload"

/** Paths this editor owns; the generic settings form hides them. */
export const BRANDING_PATHS = ["company.logoDocumentId", "company.brandColours"] as const

const LOGO_MIME = ["image/png", "image/jpeg", "image/svg+xml"]
const HEX = /^#[0-9A-Fa-f]{6}$/
type Company = { name?: string; logoDocumentId?: string | null; brandColours?: BrandColours }

/**
 * Ticket cover branding (ADR-0038 D7): the logo is uploaded and virus-checked here, then stored by id in
 * settings.company.logoDocumentId with the brand colours; both are saved with the page's Save button. The logo is
 * rasterised by the API and never served back, so only its status is shown.
 */
export function BrandingSettings<D extends object>({ draft, onChange, issues }: { draft: D; onChange: (next: D) => void; issues: Issue[] }) {
  const t = useT()
  const { can } = useSession()
  const d = draft as D & { company?: Company }
  const company = d.company ?? {}
  const colours = company.brandColours ?? DEFAULT_BRAND_COLOURS
  const setCompany = (patch: Partial<Company>) => onChange({ ...d, company: { ...company, ...patch } })
  const setColour = (k: keyof BrandColours, v: string) => setCompany({ brandColours: { ...colours, [k]: v.toUpperCase() } })
  const [state, setState] = useState<{ s: "idle" } | { s: "busy"; label: string } | { s: "done"; filename: string } | { s: "error"; message: string }>({ s: "idle" })
  const input = useRef<HTMLInputElement>(null)
  const take = async (file: File | undefined) => {
    if (!file) return
    if (!LOGO_MIME.includes(file.type)) { setState({ s: "error", message: t("brand.logo.type") }); return }
    if (file.size > 2 * 1024 * 1024) { setState({ s: "error", message: t("brand.logo.size") }); return }
    setState({ s: "busy", label: t("brand.logo.uploading", { n: 0 }) })
    try {
      const r = await uploadAndScan("/v1/dev/branding/logo-uploads", { filename: file.name, mime: file.type, size: file.size }, file, { progress: (n) => setState({ s: "busy", label: t("brand.logo.uploading", { n }) }), scanning: () => setState({ s: "busy", label: t("td.up.scanning") }) })
      if (r.scanStatus !== "CLEAN") { setState({ s: "error", message: t("td.up.infected", { f: r.filename }) }); return }
      setCompany({ logoDocumentId: r.documentId })
      setState({ s: "done", filename: r.filename })
    } catch (e) { setState({ s: "error", message: errText(e) }) }
  }
  const errs = issues.filter((i) => i.path.startsWith("company.brandColours") || i.path === "company.logoDocumentId")
  const writable = can("settings.write")
  return (
    <fieldset className="mt-4 rounded-lg border border-rule bg-surface p-4" data-testid="branding">
      <legend className="px-1.5 text-meta font-semibold text-ink">{t("brand.title")}</legend>
      <p className="mb-3 text-meta text-steel">{t("brand.hint")}</p>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-4">
          <div>
            <p className="text-meta font-medium">{t("brand.logo")}</p>
            <p className="text-caption text-steel" data-testid="logo-state">{company.logoDocumentId ? <>{t("brand.logo.set")} <span className="font-mono" dir="ltr">{company.logoDocumentId.slice(0, 8)}…</span></> : t("brand.logo.default")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!writable || state.s === "busy"} onClick={() => input.current?.click()} data-testid="logo-upload"><Upload aria-hidden />{t("brand.logo.upload")}</Button>
              {company.logoDocumentId && <Button type="button" size="sm" variant="ghost" disabled={!writable} onClick={() => { setCompany({ logoDocumentId: null }); setState({ s: "idle" }) }}>{t("brand.logo.remove")}</Button>}
              <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml" className="sr-only" tabIndex={-1} aria-label={t("brand.logo.upload")} onChange={(e) => { void take(e.target.files?.[0]); e.target.value = "" }} />
            </div>
            <p aria-live="polite" className="mt-1 min-h-5 text-meta">
              {state.s === "busy" && <span className="inline-flex items-center gap-1.5 text-steel"><Loader2 className="size-3.5 animate-spin" aria-hidden />{state.label}</span>}
              {state.s === "done" && <span className="text-success">{t("brand.logo.ready", { f: state.filename })}</span>}
              {state.s === "error" && <span role="alert" className="text-danger">{state.message}</span>}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["primary", "accent"] as const).map((k) => (
              <div key={k}>
                <label className="block text-meta font-medium" htmlFor={`brand-${k}`}>{t(k === "primary" ? "brand.primary" : "brand.accent")}</label>
                <div className="mt-1 flex items-center gap-2">
                  <input type="color" aria-label={t(k === "primary" ? "brand.primary" : "brand.accent")} value={HEX.test(colours[k]) ? colours[k].toLowerCase() : "#000000"} onChange={(e) => setColour(k, e.target.value)} disabled={!writable} className="h-9 w-12 cursor-pointer rounded border border-rule bg-transparent p-0.5" />
                  <input id={`brand-${k}`} className={cn("field-input w-28 font-mono uppercase", !HEX.test(colours[k]) && "border-danger")} value={colours[k]} maxLength={7} onChange={(e) => setColour(k, e.target.value)} disabled={!writable} dir="ltr" data-testid={`brand-${k}`} />
                </div>
              </div>
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" disabled={!writable} onClick={() => setCompany({ brandColours: DEFAULT_BRAND_COLOURS })}>{t("brand.reset")}</Button>
        </div>
        <div aria-hidden className="overflow-hidden rounded-md border border-rule bg-white text-[10px] text-navy-950 shadow-[var(--tile-shadow)]" data-testid="brand-preview">
          <div className="flex items-center justify-between px-3 py-2.5 text-white" style={{ background: HEX.test(colours.primary) ? colours.primary : undefined }}><span className="font-semibold">{company.name ?? "Uni Travel"}</span><span className="opacity-80">E-TICKET</span></div>
          <div className="h-1" style={{ background: HEX.test(colours.accent) ? colours.accent : undefined }} />
          <div className="space-y-1.5 p-3"><div className="h-2 w-3/4 rounded bg-navy-950/15" /><div className="h-2 w-1/2 rounded bg-navy-950/10" /><div className="h-2 w-2/3 rounded bg-navy-950/10" /></div>
        </div>
      </div>
      <p className="mt-2 text-caption text-steel">{t("brand.saveNote")}</p>
      {errs.slice(0, 3).map((i) => <p key={i.path + i.message} className="mt-1 text-meta text-danger"><span dir="ltr">{i.path}</span>: {friendlyIssue(i.message, t)}</p>)}
    </fieldset>
  )
}
