import "./globals.css"

import type { Metadata } from "next"
import { headers } from "next/headers"

import { Toaster } from "@unitravel/ui/components/sonner"

import { Providers } from "@/lib/session"

import { fraunces, inter, jetbrains, vazirmatn } from "./fonts"

export const metadata: Metadata = { title: { default: "Uni Travel console", template: "%s · Uni Travel console" }, robots: { index: false, follow: false } }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const nonce = h.get("x-nonce") ?? undefined
  const surface = h.get("x-surface") ?? "admin"
  return (
    <html lang="en" dir="ltr" data-surface={surface} className={`${fraunces.variable} ${inter.variable} ${vazirmatn.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh" nonce={nonce}>
        <Providers>
          {children}
          <Toaster position="top-right" offset={56} />
        </Providers>
      </body>
    </html>
  )
}
