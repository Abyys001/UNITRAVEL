"use client"

import { ExternalLink } from "lucide-react"

import { Section } from "@/components/dev-ui"
import { type MsgKey, useT } from "@/lib/i18n"

const HELP: { key: MsgKey; link?: { href: string; label: MsgKey } }[] = [
  { key: "apify.help.1", link: { href: "https://console.apify.com/settings/integrations", label: "apify.help.tokens" } },
  { key: "apify.help.2" },
  { key: "apify.help.3", link: { href: "https://console.apify.com/settings/integrations", label: "apify.help.tokens" } },
  { key: "apify.help.4", link: { href: "https://console.apify.com/billing/limits", label: "apify.help.limits" } },
]
/** Read-only for every `provider.config.read` holder (ADR-0032 B2); it never shows or asks for more than the token. */
export function ApifyHelp() {
  const t = useT()
  return (
    <Section title={t("apify.help.title")} data-testid="apify-help">
      <ol className="list-decimal space-y-2 ps-5 text-meta">
        {HELP.map((h) => (
          <li key={h.key}>{t(h.key)}{h.link && <> <a href={h.link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-link hover:underline">{t(h.link.label)}<ExternalLink aria-hidden className="size-3.5" /></a></>}</li>
        ))}
      </ol>
    </Section>
  )
}
