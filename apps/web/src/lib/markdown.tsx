import Link from "next/link"
import { Fragment, type ReactNode } from "react"

import type { Locale } from "@unitravel/i18n"

// Small Markdown renderer for CMS bodies (ADR-0017). Raw HTML is never interpreted: every piece of text becomes a React
// text node, links are limited to http(s), mailto, fragments and site paths, images to https or site paths.

export interface Heading { id: string; text: string; level: 2 | 3 }

const slugify = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section"
const plainText = (s: string) => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "")
const SAFE_URL = /^(https?:\/\/|mailto:|#|\/(?!\/))/i

function href(url: string, locale: Locale): string | null {
  const u = url.trim()
  if (!SAFE_URL.test(u)) return null
  return u.startsWith("/") && !/^\/(en|fa)(\/|$)/.test(u) ? `/${locale}${u}` : u
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|!?\[[^\]]*\]\([^)\s]+\))/g

function inline(text: string, locale: Locale, key = ""): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const k = `${key}${n++}`
    if (tok.startsWith("**")) out.push(<strong key={k} className="font-bold text-navy-950">{inline(tok.slice(2, -2), locale, k)}</strong>)
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-cloud px-1.5 py-0.5 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith("![")) {
      const [, alt, url] = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(tok)!
      out.push(/^(https:\/\/|\/(?!\/))/.test(url) ? /* eslint-disable-next-line @next/next/no-img-element */ <img key={k} src={url} alt={alt} loading="lazy" className="my-2 h-auto max-w-full rounded-xl" /> : alt)
    } else if (tok.startsWith("[")) {
      const [, label, url] = /\[([^\]]*)\]\(([^)\s]+)\)/.exec(tok)!
      const h = href(url, locale)
      const cls = "font-semibold text-royal underline underline-offset-4 hover:text-navy-900"
      if (!h) out.push(label)
      else if (h.startsWith("/")) out.push(<Link key={k} href={h} className={cls}>{inline(label, locale, k)}</Link>)
      else out.push(<a key={k} href={h} className={cls} {...(h.startsWith("http") ? { rel: "noopener noreferrer", target: "_blank" } : {})}>{inline(label, locale, k)}</a>)
    } else out.push(<em key={k}>{inline(tok.slice(1, -1), locale, k)}</em>)
    last = at + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
const isSeparator = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row)
const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/

export function renderMarkdown(source: string, locale: Locale): { nodes: ReactNode[]; headings: Heading[] } {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const nodes: ReactNode[] = []
  const headings: Heading[] = []
  const used = new Map<string, number>()
  let i = 0
  let k = 0
  const startsBlock = (l: string) => /^\s*(#{1,4}\s|>|---+\s*$|\|)/.test(l) || BULLET.test(l) || ORDERED.test(l)

  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }
    const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      // The page title is the only h1; body "#" becomes h2 so the outline stays valid.
      const level = Math.min(4, Math.max(2, h[1]!.length)) as 2 | 3 | 4
      const text = plainText(h[2]!)
      const base = slugify(text)
      const c = used.get(base) ?? 0
      used.set(base, c + 1)
      const id = c ? `${base}-${c + 1}` : base
      if (level <= 3) headings.push({ id, text, level: level as 2 | 3 })
      const Tag = `h${level}` as "h2" | "h3" | "h4"
      const cls = level === 2 ? "mt-10 scroll-mt-24 font-display text-2xl text-navy-950" : level === 3 ? "mt-8 scroll-mt-24 text-xl font-bold text-navy-950" : "mt-6 scroll-mt-24 text-lg font-bold text-navy-950"
      nodes.push(<Tag key={k++} id={id} className={cls}>{inline(h[2]!, locale)}</Tag>)
      i++
    } else if (/^---+\s*$/.test(line)) { nodes.push(<hr key={k++} className="my-8 border-line" />); i++ }
    else if (line.trimStart().startsWith(">")) {
      const buf: string[] = []
      while (i < lines.length && lines[i]!.trimStart().startsWith(">")) buf.push(lines[i++]!.replace(/^\s*>\s?/, ""))
      nodes.push(<blockquote key={k++} className="my-6 rounded-xl border-s-4 border-orange bg-warning-subtle px-5 py-4 leading-8 text-warning-subtle-fg">{inline(buf.join(" "), locale)}</blockquote>)
    } else if (line.includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1]!)) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(cells(lines[i++]!))
      nodes.push(
        <div key={k++} className="my-6 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[32rem] border-collapse text-start text-sm">
            <thead className="bg-cloud text-navy-950"><tr>{head.map((c, j) => <th key={j} scope="col" className="px-4 py-3 text-start font-bold">{inline(c, locale)}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{rows.map((r, j) => <tr key={j}>{r.map((c, x) => <td key={x} className="px-4 py-3 align-top leading-7 text-steel">{inline(c, locale)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
    } else if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line)
      const re = ordered ? ORDERED : BULLET
      const items: string[] = []
      while (i < lines.length && re.test(lines[i]!)) items.push(re.exec(lines[i++]!)![1]!)
      const Tag = ordered ? "ol" : "ul"
      const cls = ordered ? "list-decimal rtl:[list-style-type:persian] marker:font-bold marker:text-navy-900" : "list-disc marker:text-orange"
      nodes.push(<Tag key={k++} className={`${cls} my-4 space-y-2 ps-6 leading-8 text-steel`}>{items.map((t, j) => <li key={j} className="ps-1">{inline(t, locale)}</li>)}</Tag>)
    } else {
      const buf = [line]
      i++
      while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!)) buf.push(lines[i++]!)
      nodes.push(<p key={k++} className="my-4 leading-8 text-steel">{buf.map((t, j) => <Fragment key={j}>{j > 0 && " "}{inline(t.trim(), locale)}</Fragment>)}</p>)
    }
  }
  return { nodes, headings }
}
