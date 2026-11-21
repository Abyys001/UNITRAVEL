"use client"

import { CircleCheck } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef } from "react"

import { useI18n } from "@/lib/i18n"

export interface ConfirmationAction { href: string; label: string }

export interface ConfirmationPanelProps {
  title: string
  lead?: React.ReactNode
  reference?: string
  /** "What happens next", in order. */
  steps?: React.ReactNode[]
  /** Paths without the language prefix; the panel localises them. */
  primary?: ConfirmationAction
  secondary?: ConfirmationAction
  disclaimer?: React.ReactNode
}

/** Shared success state after a request is sent. The title takes focus so screen readers hear the outcome first. */
export function ConfirmationPanel({ title, lead, reference, steps, primary, secondary, disclaimer }: ConfirmationPanelProps) {
  const { t, href, locale } = useI18n()
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => { titleRef.current?.focus() }, [])
  const n = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB")
  return (
    <section aria-labelledby="confirmation-title" className="rounded-2xl border border-success-border bg-success-subtle/60 p-5 md:p-7">
      <div className="flex items-start gap-3">
        <CircleCheck className="mt-0.5 size-7 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <h2 id="confirmation-title" ref={titleRef} tabIndex={-1} className="font-display text-xl text-navy-950 outline-none">{title}</h2>
          {lead ? <p className="mt-1 text-sm text-navy-900">{lead}</p> : null}
          {reference ? (
            <p className="mt-3 text-sm text-steel">
              {t("guide.common.reference")}:{" "}
              <span dir="ltr" className="rounded-md bg-white px-2 py-0.5 font-mono text-base font-semibold text-navy-950 ring-1 ring-success-border">{reference}</span>
            </p>
          ) : null}
        </div>
      </div>
      {steps?.length ? (
        <div className="mt-5 rounded-xl bg-white p-4 ring-1 ring-success-border">
          <h3 className="text-sm font-bold text-navy-950">{t("guide.common.whatNext")}</h3>
          <ol className="mt-3 grid gap-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-navy-900">
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-navy-900 text-xs font-bold text-white">{n.format(i + 1)}</span>
                <span className="min-w-0 pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {primary || secondary ? (
        <div className="mt-5 flex flex-wrap gap-3">
          {primary ? <Link href={href(primary.href)} className="btn-orange min-h-11 px-6">{primary.label}</Link> : null}
          {secondary ? <Link href={href(secondary.href)} className="inline-flex min-h-11 items-center rounded-full border border-navy-900 px-5 text-sm font-semibold text-navy-950 transition-colors hover:bg-navy-950 hover:text-white">{secondary.label}</Link> : null}
        </div>
      ) : null}
      {disclaimer ? <div className="mt-4 text-xs text-steel">{disclaimer}</div> : null}
    </section>
  )
}
