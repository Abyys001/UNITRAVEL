import "../globals.css"

import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { dir, type Locale } from "@unitravel/i18n"
import { Toaster } from "@unitravel/ui/components/sonner"

import { Footer, Header } from "@/components/shell"
import { I18nProvider } from "@/lib/i18n"
import { Providers } from "@/lib/session"

import { jetbrains, montserrat, vazirmatn } from "../fonts"

export const metadata: Metadata = { metadataBase: new URL(process.env.PUBLIC_WEB_URL ?? "http://localhost:4000"), openGraph: { siteName: "Uni Travel", type: "website" }, title: { default: "Uni Travel", template: "%s · Uni Travel" }, description: "Flights and cargo between Iran, the UK and Europe — found honestly, arranged by people." }

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (locale !== "en" && locale !== "fa") notFound()
  const nonce = (await headers()).get("x-nonce") ?? undefined
  return (
    <html lang={locale} dir={dir(locale as Locale)} className={`${montserrat.variable} ${vazirmatn.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh flex flex-col" nonce={nonce}>
        <I18nProvider locale={locale as Locale}>
          <Providers>
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <Toaster position="top-center" />
          </Providers>
        </I18nProvider>
      </body>
    </html>
  )
}
