import "./globals.css"

import { headers } from "next/headers"
import Link from "next/link"

import { dir, translate, type Locale } from "@unitravel/i18n"

import { jetbrains, montserrat, vazirmatn } from "./fonts"

/** Unmatched URLs have no [locale] layout, so this renders its own document (lang, dir, CSP nonce) in the visitor's locale. */
export default async function GlobalNotFound() {
  const h = await headers()
  const locale: Locale = h.get("x-locale") === "fa" ? "fa" : "en"
  return (
    <html lang={locale} dir={dir(locale)} className={`${montserrat.variable} ${vazirmatn.variable} ${jetbrains.variable}`}>
      <body className="grid min-h-dvh place-items-center px-4 text-center" nonce={h.get("x-nonce") ?? undefined}>
        <main>
          <h1 className="font-display text-3xl md:text-4xl">{translate(locale, "notFound.title")}</h1>
          <p className="mt-3 text-steel">{translate(locale, "notFound.body")}</p>
          <Link href={`/${locale}`} className="btn-orange mt-8">{translate(locale, "notFound.home")}</Link>
        </main>
      </body>
    </html>
  )
}
