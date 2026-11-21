"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Camera, Eraser, Mail, MapPin, Phone, X } from "lucide-react"

import { Directions } from "@/components/directions"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { StatusChip, TileError } from "@/components/bento"
import { type AgentJob, failureReasons, formatTn, imageData, KIND_KEY, milestoneTone } from "@/components/cargo-ops"
import { Arrow, Field, Loading, Panel } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { useCrumbLabel } from "@/lib/crumb"
import { fmtDateTime } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"

const ACTION_LABEL: Record<string, MsgKey> = {
  accept: "agt.a.accept", decline: "agt.a.decline", start_collection: "agt.a.start_collection", collected: "agt.a.collected", collection_failed: "agt.a.collection_failed",
  handled: "agt.a.handled", at_sorting_facility: "agt.a.at_sorting_facility", handling_done: "agt.a.handling_done", out_for_delivery: "agt.a.out_for_delivery",
  delivered: "agt.a.delivered", delivery_failed: "agt.a.delivery_failed", report_problem: "agt.a.report_problem", note: "agt.a.note",
}
const PRIMARY = new Set(["accept", "collected", "delivered", "out_for_delivery", "start_collection", "handled", "at_sorting_facility"])
const DANGER = new Set(["decline", "collection_failed", "delivery_failed"])
const PROBLEMS = ["ADDRESS", "CONTACT", "PACKAGING", "DAMAGE", "VEHICLE", "SAFETY", "OTHER"] as const

/** A finger or mouse signature, exported as PNG. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const t = useT()
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)
  useEffect(() => {
    const c = ref.current!
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio
    const ctx = c.getContext("2d")!
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1f4d"
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height)
  }, [])
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const clear = () => { const c = ref.current!; const ctx = c.getContext("2d")!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); dirty.current = false; onChange(null) }
  return (
    <div>
      <canvas ref={ref} className="h-40 w-full touch-none rounded-lg border border-rule-strong bg-white" aria-label={t("agt.signHere")} data-testid="signature-pad"
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const p = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(p.x, p.y) }}
        onPointerMove={(e) => { if (!drawing.current) return; const p = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true }}
        onPointerUp={() => { drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL("image/png")) }} />
      <div className="mt-1 flex items-center justify-between text-caption text-steel"><span>{t("agt.signHere")}</span><button type="button" className="inline-flex items-center gap-1 font-medium text-link" onClick={clear}><Eraser className="size-3.5" />{t("agt.clear")}</button></div>
    </div>
  )
}

function ActionForm({ job, action, onDone, onCancel }: { job: AgentJob; action: string; onDone: (j: AgentJob) => void; onCancel: () => void }) {
  const t = useT()
  const [locale] = useLocale()
  const place = job.kind === "DELIVERY" ? job.dropoff.city : job.pickup.city
  const [f, setF] = useState({ location: place, name: action === "collected" ? job.pickup.name : action === "delivered" ? job.dropoff.name : "", reason: "NO_ONE_AVAILABLE", description: "", body: "", category: "ADDRESS" })
  const [signature, setSignature] = useState<string | null>(null)
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const needsProof = action === "collected" || action === "delivered"
  const failed = action === "collection_failed" || action === "delivery_failed"
  const problem = action === "report_problem"
  const noPlace = ["note", "decline", "handling_done", "report_problem", "accept"].includes(action)
  const addPhoto = async (file?: File) => {
    if (!file) return
    setBusy(true); setErr(null)
    try { const data = await imageData(file); const r = await api<{ documentId: string }>(`/v1/agent/jobs/${job.assignmentId}/files`, { body: { filename: file.name || "photo.jpg", data, purpose: "PHOTO" } }); setPhotos((p) => [...p, { id: r.documentId, name: file.name || "photo" }]) } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      let signatureDocumentId: string | undefined
      if (needsProof && signature) signatureDocumentId = (await api<{ documentId: string }>(`/v1/agent/jobs/${job.assignmentId}/files`, { body: { filename: "signature.png", data: signature, purpose: "SIGNATURE" } })).documentId
      const photoDocumentIds = photos.map((p) => p.id)
      const body: Record<string, unknown> =
        action === "note" ? { body: f.body }
        : action === "accept" ? {}
        : action === "decline" ? { reason: f.description }
        : action === "handling_done" ? { description: f.description || undefined }
        : action === "report_problem" ? { category: f.category, description: f.description, photoDocumentIds }
        : action === "at_sorting_facility" ? { location: f.location }
        : action === "collected" ? { location: f.location, handedOverBy: f.name, signatureDocumentId, photoDocumentIds, description: f.description || undefined }
        : action === "delivered" ? { location: f.location, receiverName: f.name, signatureDocumentId, photoDocumentIds, description: f.description || undefined }
        : failed ? { location: f.location, reason: f.reason, description: f.description || undefined, photoDocumentIds }
        : { location: f.location, description: f.description || undefined }
      const r = await api<AgentJob>(`/v1/agent/jobs/${job.assignmentId}/actions/${action}`, { body })
      toast.success(t("agt.saved"))
      onDone(r)
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }
  const photoPicker = () => (
    <div>
      <p className="mb-1 text-meta font-medium">{t("agt.photos")}{action === "delivered" && <span className="font-normal text-steel"> · {t("agt.proofRule")}</span>}</p>
      <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-rule-strong px-3 font-medium">
        <Camera className="size-4" aria-hidden />{t("agt.addPhoto")}
        <input type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = "" }} disabled={busy} data-testid="photo-input" />
      </label>
      <ul className="mt-1 text-caption text-steel">{photos.map((p) => <li key={p.id} className="flex items-center gap-1">✓ {p.name}<button type="button" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))} aria-label={t("agt.remove")}><X className="size-3" /></button></li>)}</ul>
    </div>
  )
  return (
    <form onSubmit={submit} className="space-y-3 rounded-[var(--radius-card)] border border-control bg-surface-raised p-4 shadow-[var(--tile-shadow)]" data-testid={`form-${action}`}>
      <p className="flex items-center justify-between font-semibold">{t(ACTION_LABEL[action]!)}<button type="button" onClick={onCancel} aria-label={t("nav.close")}><X className="size-4" /></button></p>
      {action === "note" ? <Field label={t("agt.noteLabel")}><textarea className="field-input min-h-24" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required dir="auto" /></Field>
      : action === "accept" ? <p className="text-steel">{t("agt.acceptHint")}</p>
      : action === "decline" || action === "handling_done" ? <Field label={action === "decline" ? t("agt.declineReason") : t("agt.comment")}><textarea className="field-input min-h-20" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required={action === "decline"} minLength={action === "decline" ? 3 : undefined} dir="auto" /></Field>
      : problem ? (
        <>
          <Field label={t("agt.problemType")}><NativeSelect className="field-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{PROBLEMS.map((k) => <option key={k} value={k}>{t(`agt.p.${k}` as never)}</option>)}</NativeSelect></Field>
          <Field label={t("agt.problemText")}><textarea className="field-input min-h-24" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required minLength={3} dir="auto" /></Field>
          {photoPicker()}
        </>
      ) : (
        <>
          {!noPlace && <Field label={t("agt.where")} hint={t("ops.placeHint")}><input className="field-input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} required minLength={2} maxLength={120} /></Field>}
          {needsProof && <Field label={action === "collected" ? t("agt.handedOverBy") : t("agt.receiverName")}><input className="field-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} dir="auto" autoComplete="off" /></Field>}
          {failed && <Field label={t("agt.reason")}><NativeSelect className="field-input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{failureReasons.map(([k, v]) => <option key={k} value={k}>{v[locale]}</option>)}</NativeSelect></Field>}
          {needsProof && <div><p className="mb-1 text-meta font-medium">{t("agt.signature")}</p><SignaturePad onChange={setSignature} /></div>}
          {(needsProof || failed) && photoPicker()}
          {!["out_for_delivery", "at_sorting_facility"].includes(action) && <Field label={t("agt.comment")}><input className="field-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} dir="auto" /></Field>}
        </>
      )}
      {err && <p role="alert" className="rounded-md bg-danger-subtle px-2 py-1.5 text-danger">{err}</p>}
      <Button type="submit" className="h-12 w-full text-body" loading={busy} variant={failed || action === "decline" ? "destructive" : "default"} data-testid="action-submit">{t(ACTION_LABEL[action]!)}</Button>
    </form>
  )
}

function Contact({ title, p }: { title: string; p: AgentJob["pickup"] }) {
  const t = useT()
  return (
    <Panel title={title}>
      <p className="font-medium" dir="auto">{p.name}{p.company && <span className="text-steel"> · {p.company}</span>}</p>
      <p className="mt-1 flex gap-1.5 text-steel" dir="auto"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{p.address}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {p.phone && <a href={`tel:${p.phone.replace(/[^+\d]/g, "")}`} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-rule-strong px-3 font-medium" dir="ltr"><Phone className="size-4" aria-hidden />{p.phone}</a>}
        {p.email && <a href={`mailto:${p.email}`} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-rule-strong px-3 font-medium"><Mail className="size-4" aria-hidden />{t("ops.edit.email")}</a>}
        {/* Directions only to a real, accepted address (an offered job shows the town only; a drop-off has no address). */}
        {p.address && p.phone && <Directions address={p.address} />}
        {p.address && <a href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(p.address)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-rule-strong px-3 font-medium"><MapPin className="size-4" aria-hidden />{t("agt.map")}</a>}
      </div>
    </Panel>
  )
}

export default function AgentJobPage() {
  const { id } = useParams<{ id: string }>()
  const t = useT()
  const qc = useQueryClient()
  const key = ["agent-job", id]
  const q = useQuery({ queryKey: key, queryFn: () => api<AgentJob>(`/v1/agent/jobs/${id}`) })
  useCrumbLabel(q.data?.ref ?? null)
  const [action, setAction] = useState<string | null>(null)
  const j = q.data
  if (q.error) return <div className="p-4"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!j) return <Loading />
  const done = (next: AgentJob) => { qc.setQueryData(key, next); void qc.invalidateQueries({ queryKey: ["agent-jobs"] }); setAction(null) }
  return (
    <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4 pb-24" data-testid="agent-job-page">
      <Link href="/agent" className="inline-flex items-center gap-1 text-meta font-medium text-link"><Arrow back />{t("agt.back")}</Link>
      <header className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-4 shadow-[var(--tile-shadow)]">
        <p className="flex items-center justify-between gap-2"><span className="font-display text-title font-bold">{t(KIND_KEY[j.kind])}</span><StatusChip tone={milestoneTone(j.milestone)}><span data-testid="job-milestone">{j.milestoneLabel}</span></StatusChip></p>
        <p className="ref mt-1" dir="ltr">{j.ref}{j.trackingNumber && ` · ${formatTn(j.trackingNumber)}`}</p>
        <p className="mt-1 text-meta text-steel">{t("ops.c.piecesN", { n: j.pieces, kg: j.weightKg })} · <span dir="auto">{j.description}</span></p>
        {j.scheduledFor && <p className="mt-1 text-meta">{t("ops.job.planned", { at: fmtDateTime(j.scheduledFor) })}</p>}
        {j.preferredDeliveryDate && j.kind === "DELIVERY" && <p className="mt-1 text-meta">{t("ops.preferred")}: <span className="num">{j.preferredDeliveryDate}</span></p>}
        {j.attempts > 0 && <p className="mt-1 text-meta text-danger">{t("ops.job.attempts", { n: j.attempts })}</p>}
        {j.handlingInstructions && <p className="mt-2 rounded-md bg-danger-subtle px-2 py-1.5 font-medium text-danger" dir="auto">{j.handlingInstructions}</p>}
        {j.note && <p className="mt-2 text-meta" dir="auto">{t("agt.officeNote")}: {j.note}</p>}
      </header>
      {action ? <ActionForm job={j} action={action} onDone={done} onCancel={() => setAction(null)} /> : (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="agent-actions">
          {j.actions.map((a) => <Button key={a} className="h-12 text-body" variant={PRIMARY.has(a) ? "default" : DANGER.has(a) ? "destructive" : "outline"} onClick={() => setAction(a)} data-testid={`act-${a}`}>{t(ACTION_LABEL[a]!)}</Button>)}
        </div>
      )}
      {j.status === "OFFERED" && <p className="rounded-md bg-orange/10 px-3 py-2 text-meta">{t("agt.offeredHint")}</p>}
      <Contact title={j.kind === "DELIVERY" ? t("agt.deliverTo") : t("agt.collectFrom")} p={j.kind === "DELIVERY" ? j.dropoff : j.pickup} />
      <Contact title={j.kind === "DELIVERY" ? t("agt.sender") : t("agt.deliverTo")} p={j.kind === "DELIVERY" ? j.pickup : j.dropoff} />
      {j.otherAgents.length > 0 && <Panel title={t("agt.team")}><ul className="text-meta">{j.otherAgents.map((o) => <li key={`${o.kind}${o.agentCode}`}>{t(KIND_KEY[o.kind])}: <span dir="auto">{o.name}</span> <span className="ref text-steel">{o.agentCode}</span></li>)}</ul></Panel>}
      <Panel title={t("agt.history")}>
        <ol className="ledger-rows">{j.timeline.map((e, i) => <li key={i} className="py-1.5"><p className="flex justify-between gap-2"><span className="font-medium">{e.label}</span><span className="num text-meta text-steel">{fmtDateTime(e.occurredAt)}</span></p><p className="text-caption text-steel">{e.location}{e.agent && ` · ${e.agent}`}{e.description && ` · ${e.description}`}</p></li>)}</ol>
      </Panel>
    </div>
  )
}
