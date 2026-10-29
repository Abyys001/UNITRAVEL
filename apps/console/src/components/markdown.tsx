import { Fragment, type ReactNode } from "react"

/**
 * Small Markdown renderer for the editor preview: headings, paragraphs, lists, tables, quotes, rules, bold, italic,
 * code and links. It builds React elements only, so raw HTML in the text is shown as text and never executed (ADR-0017).
 */
const SAFE_URL = /^(https?:\/\/|\/|#|mailto:)/i
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const k = `${key}-${i}`
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={k}>{part.slice(2, -2)}</strong>
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={k} className="rounded bg-muted px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
    if (link) return SAFE_URL.test(link[2]!) ? <a key={k} href={link[2]} className="text-link underline" rel="noreferrer noopener" target={link[2]!.startsWith("http") ? "_blank" : undefined}>{link[1]}</a> : <Fragment key={k}>{link[1]}</Fragment>
    return <Fragment key={k}>{part}</Fragment>
  })
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const key = `b${i}`
    if (!line.trim()) { i++; continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1]!.length
      const cls = level === 1 ? "mt-5 text-xl font-semibold" : level === 2 ? "mt-5 text-lead font-semibold" : "mt-4 font-semibold"
      out.push(level === 1 ? <h2 key={key} className={cls}>{inline(h[2]!, key)}</h2> : level === 2 ? <h3 key={key} className={cls}>{inline(h[2]!, key)}</h3> : <h4 key={key} className={cls}>{inline(h[2]!, key)}</h4>)
      i++; continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push(<hr key={key} className="my-4 border-rule" />); i++; continue }
    if (/^>\s?/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ""))
      out.push(<blockquote key={key} className="my-3 border-s-4 border-rule-strong ps-3 text-steel">{inline(q.join(" "), key)}</blockquote>)
      continue
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""))
      const li = items.map((x, n) => <li key={n}>{inline(x, `${key}-${n}`)}</li>)
      out.push(ordered ? <ol key={key} className="my-3 list-decimal space-y-1 ps-6">{li}</ol> : <ul key={key} className="my-3 list-disc space-y-1 ps-6">{li}</ul>)
      continue
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(cells(lines[i++]!))
      out.push(
        <div key={key} className="my-3 overflow-x-auto" tabIndex={0} role="region" aria-label="table">
          <table className="w-full border-collapse text-start">
            <thead><tr>{head.map((c, n) => <th key={n} scope="col" className="border-b border-rule-strong px-2 py-1.5 text-start font-semibold">{inline(c, `${key}-h${n}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, n) => <tr key={n}>{r.map((c, m) => <td key={m} className="border-b border-rule px-2 py-1.5">{inline(c, `${key}-${n}-${m}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    const p: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|>|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i]!)) p.push(lines[i++]!)
    out.push(<p key={key} className="my-2 leading-relaxed">{inline(p.join(" "), key)}</p>)
  }
  return <div className={className} dir="auto">{out}</div>
}
