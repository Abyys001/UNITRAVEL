"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import type { TravellerView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Switch } from "@unitravel/ui/components/switch"

import { TravellerForm } from "@/components/traveller-form"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

export default function AccountPage() {
  const { t, date, href, locale, sep } = useI18n()
  const { me } = useRequireSignIn()
  const qc = useQueryClient()
  const router = useRouter()
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const [deleting, setDeleting] = useState(false)
  const travellers = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: !!me })
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<{ id: string; client: string; userAgent: string | null; lastSeenAt: string; current: boolean }[]>("/v1/me/sessions"), enabled: !!me })
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api("/v1/me", { method: "PATCH", body }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["me"] }); toast.success("✓") } })
  if (!me) return null
  const prefs = me.notificationPrefs
  const exportData = async () => {
    const data = await api("/v1/me/export", { body: {} })
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
    Object.assign(document.createElement("a"), { href: url, download: "uni-travel-my-data.json" }).click()
  }
  const signOut = async () => { await api("/v1/auth/logout", { body: {} }); await qc.invalidateQueries({ queryKey: ["me"] }); router.replace(href("/")) }
  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-8">
      <div className="flex items-end justify-between"><h1 className="font-display text-3xl">{t("account.title")}</h1><Button variant="outline" onClick={() => void signOut()}>{t("nav.signOut")}</Button></div>
      <section><h2 className="mb-3 text-xl font-semibold">{t("account.profile")}</h2>
        <div className="rounded-lg border border-border bg-white p-4 text-sm">
          <p className="font-medium" dir="ltr">{me.profile?.givenNamesLatin} {me.profile?.surnameLatin}</p>{me.profile?.nameFa && <p>{me.profile.nameFa}</p>}
          <ul className="mt-2 space-y-1">{me.identities.map((i) => <li key={i.id} dir="ltr" className="text-slate">{i.value}{sep}{i.verifiedAt ? `${t("account.verified")} ${date(i.verifiedAt, { dateOnly: true })}` : t("account.unverified")}</li>)}</ul>
        </div>
      </section>
      <section><h2 className="mb-3 text-xl font-semibold">{t("account.travellers")}</h2>
        <ul className="space-y-2">{travellers.data?.map((tr) => (
          <li key={tr.id} className="rounded-lg border border-border bg-white p-3">
            <div className="flex items-center justify-between text-sm"><span dir="ltr" className="font-medium">{tr.title} {tr.givenNames} {tr.surname}</span><span className="text-slate">{tr.document ? `${t("account.documentComplete")} ••${tr.document.last4}` : t("account.documentMissing")}</span><Button variant="ghost" size="sm" onClick={() => setEditing(tr.id)}>{t("common.edit")}</Button></div>
            {editing === tr.id && <div className="mt-3"><TravellerForm initial={tr} onSaved={() => { setEditing(null); void travellers.refetch() }} /></div>}
          </li>
        ))}</ul>
        {editing === "new" ? <div className="mt-3"><TravellerForm onSaved={() => { setEditing(null); void travellers.refetch() }} /></div> : <Button variant="outline" className="mt-3" onClick={() => setEditing("new")}>{t("request.addTraveller")}</Button>}
      </section>
      <section><h2 className="mb-3 text-xl font-semibold">{t("account.preferences")}</h2>
        <div className="space-y-3 rounded-lg border border-border bg-white p-4 text-sm">
          <label className="flex items-center justify-between">{t("account.language")}<select className="rounded border border-border px-2 py-1" value={me.preferredLocale} onChange={(e) => { patch.mutate({ preferredLocale: e.target.value }); router.replace(`/${e.target.value}/account`) }}><option value="en">English</option><option value="fa">فارسی</option></select></label>
          <label className="flex items-center justify-between">{t("account.calendar")}<select className="rounded border border-border px-2 py-1" value={me.calendar} onChange={(e) => patch.mutate({ calendar: e.target.value })}><option value="GREGORIAN">{t("search.gregorian")}</option><option value="JALALI">{t("search.jalali")}</option></select></label>
          <p className="pt-2 font-medium">{t("account.notifications")}</p>
          {(["PUSH", "SMS", "EMAIL"] as const).map((c) => <label key={c} className="flex items-center justify-between">{t(c === "PUSH" ? "account.notifPush" : c === "SMS" ? "account.notifSms" : "account.notifEmail")}<Switch checked={prefs[c] !== false} onCheckedChange={(v) => patch.mutate({ notificationPrefs: { ...prefs, [c]: v } })} /></label>)}
          <p className="text-xs text-slate">{t("account.essential")}</p>
        </div>
      </section>
      <section><h2 className="mb-3 text-xl font-semibold">{t("account.sessions")}</h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-white text-sm">{sessions.data?.map((s) => <li key={s.id} className="flex items-center justify-between px-4 py-2"><span>{s.client}{sep}{s.userAgent?.slice(0, 40)}{sep}{date(s.lastSeenAt, { withTime: true })}{s.current && " · ✓"}</span>{!s.current && <Button variant="ghost" size="sm" onClick={async () => { await api(`/v1/me/sessions/${s.id}`, { method: "DELETE" }); void sessions.refetch() }}>{t("account.revoke")}</Button>}</li>)}</ul>
      </section>
      <section><h2 className="mb-3 text-xl font-semibold">{t("account.privacy")}</h2>
        <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void exportData()}>{t("account.export")}</Button>
          {deleting ? <span className="flex items-center gap-2 text-sm"><Button variant="destructive" onClick={async () => { await api("/v1/me/delete", { body: {} }); router.replace(href("/")) }}>{t("common.yes")}</Button><Button variant="outline" onClick={() => setDeleting(false)}>{t("common.no")}</Button></span> : <Button variant="outline" className="text-brick" onClick={() => setDeleting(true)}>{t("account.delete")}</Button>}
        </div>
        <p className="mt-2 max-w-xl text-sm text-slate" lang={locale}>{t("account.deleteNote")}</p>
      </section>
    </div>
  )
}
