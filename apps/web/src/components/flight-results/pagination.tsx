"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

import { useI18n } from "@/lib/i18n"

import { pageItems } from "./filters"

const btn = "inline-flex size-10 items-center justify-center rounded-xl border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"

/** Page numbers follow the locale's digits (Persian in fa); the buttons are real buttons because the state lives in the URL via the parent's router.replace. */
export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t, locale } = useI18n()
  const nf = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB")
  if (pages <= 1) return null
  const step = "border-line bg-white text-navy-950 hover:border-navy-900/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
  return (
    <nav aria-label={t("guide.flights.pagesLabel")} className="mt-6" data-testid="flight-pagination">
      <ul className="flex flex-wrap items-center justify-center gap-1.5">
        <li>
          <button type="button" className={`${btn} ${step} !w-auto gap-1 px-3`} disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="page-prev">
            <ChevronLeft aria-hidden className="size-4 rtl:rotate-180" /><span className="hidden sm:inline">{t("guide.flights.prev")}</span><span className="sr-only sm:hidden">{t("guide.flights.prev")}</span>
          </button>
        </li>
        {pageItems(page, pages).map((n, i) => n === "gap"
          ? <li key={`gap-${i}`} aria-hidden className="px-1 text-steel">…</li>
          : (
            <li key={n}>
              <button
                type="button" onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined}
                aria-label={t(n === page ? "guide.flights.currentPageN" : "guide.flights.pageN", { n: nf.format(n) })}
                className={`${btn} tabular-nums ${n === page ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-navy-950 hover:border-navy-900/40"}`}
                data-testid={`page-${n}`}
              >{nf.format(n)}</button>
            </li>
          ))}
        <li>
          <button type="button" className={`${btn} ${step} !w-auto gap-1 px-3`} disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="page-next">
            <span className="hidden sm:inline">{t("guide.flights.next")}</span><span className="sr-only sm:hidden">{t("guide.flights.next")}</span><ChevronRight aria-hidden className="size-4 rtl:rotate-180" />
          </button>
        </li>
      </ul>
    </nav>
  )
}
