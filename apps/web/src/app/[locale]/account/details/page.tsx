"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import type { AddressInput, MyDetails } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { AddIdentity } from "@/components/add-identity"
import { PassportVerification } from "@/components/passport-verification"
import { TravellerForm } from "@/components/traveller-form"
import { Tag } from "@/components/badges"
import { api, ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

const COUNTRIES = ["GB", "IR", "TR", "AM", "DE", "NL", "FR", "AT", "IQ", "AE", "AF", "US", "CA"]
const EMPTY: AddressInput = { line1: "", line2: "", city: "", postcode: "", country: "GB" }

/** My details: contact methods, profile, optional address, passport with verification (ADR-0005). */
export default function MyDetailsPage() {
  const { t, href } = useI18n()
  const { me } = useRequireSignIn()
  const qc = useQueryClient()
  const details = useQuery({ queryKey: ["details"], queryFn: () => api<MyDetails>("/v1/me/details"), enabled: !!me })
  const [editingPassport, setEditingPassport] = useState(false)
  const [profile, setProfile] = useState<{ nameFa: string; contactTimePref: string } | null>(null)
  const [address, setAddress] = useState<AddressInput | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<MyDetails>("/v1/me/details", { method: "PATCH", body }),
    onSuccess: (d) => { qc.setQueryData(["details"], d); setErr(null); toast.success(t("identity.saved")) },
    onError: (e) => setErr(e instanceof ApiError ? e.problem.errors?.map((x) => `${x.path}: ${x.message ?? x.code}`).join(", ") || e.problem.title : t("common.error")),
  })
  const d = details.data
  if (!me || !d) return null
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["details"] }); void qc.invalidateQueries({ queryKey: ["travellers"] }) }
  const p = profile ?? { nameFa: d.nameFa ?? "", contactTimePref: d.contactTimePref ?? "" }
  const a = address ?? d.address ?? EMPTY
  const self = d.self
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 md:py-10">
      <div><Link href={href("/account")} className="text-sm text-royal underline">← {t("account.title")}</Link><h1 className="font-display mt-2 text-3xl md:text-4xl">{t("identity.title")}</h1><p className="mt-2 text-sm text-steel">{t("identity.intro")}</p></div>

      <section aria-labelledby="contact-h"><h2 id="contact-h" className="font-display mb-1 text-xl">{t("identity.contactTitle")}</h2><p className="mb-3 text-sm text-steel">{t("identity.contactHelp")}</p>
        <div className="card-brand space-y-4 p-5 text-sm">
          <ul className="space-y-1">{d.identities.map((i) => <li key={i.id} className="flex items-center justify-between gap-3"><span dir="ltr">{i.value}</span><Tag kind={i.verified ? "priced" : "cached"}>{i.verified ? t("account.verified") : t("account.unverified")}</Tag></li>)}</ul>
          <AddIdentity onDone={refresh} />
        </div>
      </section>

      <section aria-labelledby="profile-h"><h2 id="profile-h" className="font-display mb-3 text-xl">{t("identity.profileTitle")}</h2>
        <form className="card-brand grid gap-3 p-5 text-sm sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ nameFa: p.nameFa || null, contactTimePref: p.contactTimePref || null }) }}>
          <p className="font-medium sm:col-span-2" dir="ltr">{d.givenNamesLatin} {d.surnameLatin}</p>
          <label>{t("auth.nameFa")}<Input className="mt-1 h-10" dir="rtl" value={p.nameFa} onChange={(e) => setProfile({ ...p, nameFa: e.target.value })} /></label>
          <label>{t("identity.contactTime")}<Input className="mt-1 h-10" value={p.contactTimePref} onChange={(e) => setProfile({ ...p, contactTimePref: e.target.value })} /></label>
          <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>{t("common.save")}</Button></div>
        </form>
      </section>

      <section aria-labelledby="address-h"><h2 id="address-h" className="font-display mb-1 text-xl">{t("identity.addressTitle")}</h2><p className="mb-3 text-sm text-steel">{t("identity.addressHelp")}</p>
        <form className="card-brand grid gap-3 p-5 text-sm sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ address: { ...a, line2: a.line2 || null } }) }}>
          <label className="sm:col-span-2">{t("identity.line1")}<Input className="mt-1 h-10" required autoComplete="address-line1" value={a.line1} onChange={(e) => setAddress({ ...a, line1: e.target.value })} /></label>
          <label className="sm:col-span-2">{t("identity.line2")}<Input className="mt-1 h-10" autoComplete="address-line2" value={a.line2 ?? ""} onChange={(e) => setAddress({ ...a, line2: e.target.value })} /></label>
          <label>{t("identity.city")}<Input className="mt-1 h-10" required autoComplete="address-level2" value={a.city} onChange={(e) => setAddress({ ...a, city: e.target.value })} /></label>
          <label>{t("identity.postcode")}<Input className="mt-1 h-10" dir="ltr" required autoComplete="postal-code" value={a.postcode} onChange={(e) => setAddress({ ...a, postcode: e.target.value })} /></label>
          <label>{t("identity.country")}<NativeSelect className="field mt-1 h-10 w-full" value={a.country} onChange={(e) => setAddress({ ...a, country: e.target.value })}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></label>
          {err && <p role="alert" className="text-sm text-danger sm:col-span-2">{err}</p>}
          <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={save.isPending}>{t("identity.saveDetails")}</Button>{d.address && <Button type="button" variant="outline" className="rounded-xl border-navy-900 text-navy-900" onClick={() => { setAddress(null); save.mutate({ address: null }) }}>{t("identity.clearAddress")}</Button>}</div>
        </form>
      </section>

      <section aria-labelledby="passport-h"><h2 id="passport-h" className="font-display mb-1 text-xl">{t("identity.passportTitle")}</h2><p className="mb-3 text-sm text-steel">{t("identity.passportHelp")}</p>
        <div className="card-brand space-y-4 p-5">
          {self?.document ? (
            <>
              <p className="text-sm" dir="ltr"><span className="font-medium">{self.givenNames} {self.surname}</span> · ••••{self.document.last4} · {self.document.issuingCountry} · {self.document.expiryDate}</p>
              <PassportVerification traveller={self} onChanged={refresh} />
              <Button variant="outline" className="rounded-xl border-navy-900 text-navy-900" onClick={() => setEditingPassport((x) => !x)}>{t("common.edit")}</Button>
            </>
          ) : <p className="text-sm text-steel">{t("identity.noPassport")}</p>}
          {(editingPassport || !self?.document) && (
            <TravellerForm withDocument={!self?.document} initial={self ?? undefined} prefill={{ givenNames: d.givenNamesLatin ?? "", surname: d.surnameLatin ?? "", nameFa: d.nameFa ?? "" }} onSaved={() => { setEditingPassport(false); refresh() }} />
          )}
        </div>
      </section>
    </div>
  )
}
