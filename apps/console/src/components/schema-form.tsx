"use client"

import { useState } from "react"

import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { type T, useT } from "@/lib/i18n"

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
export type Issue = { path: string; message: string }

/** Zod's raw wording ("Too small: expected number to be >=0") turned into something an operator can act on. */
export function friendlyIssue(msg: string, t: T): string {
  let m: RegExpMatchArray | null
  if (/received NaN/.test(msg)) return t("zod.number")
  if (/received undefined/.test(msg)) return t("zod.required")
  if ((m = msg.match(/expected number to be (>=|>)\s*(-?[\d.]+)/))) return t(m[1] === ">" ? "zod.gt" : "zod.min", { n: m[2]! })
  if ((m = msg.match(/expected number to be (<=|<)\s*(-?[\d.]+)/))) return t(m[1] === "<" ? "zod.lt" : "zod.max", { n: m[2]! })
  if ((m = msg.match(/expected string to have >=\s*(\d+)/))) return t("zod.minLen", { n: m[1]! })
  if ((m = msg.match(/expected string to have <=\s*(\d+)/))) return t("zod.maxLen", { n: m[1]! })
  if ((m = msg.match(/expected array to have >=\s*(\d+)/))) return t("zod.minItems", { n: m[1]! })
  if (/must match pattern|Invalid string|Invalid regex/i.test(msg)) return t("zod.format")
  if (/Invalid option|expected one of/.test(msg)) return t("zod.option")
  if (/expected (int|integer)/i.test(msg)) return t("zod.int")
  if ((m = msg.match(/expected (\w+), received/))) return t("zod.type", { type: m[1]! })
  return msg
}

const label = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v)

function JsonField({ value, onChange, path, issues }: { value: Json; onChange: (v: Json) => void; path: string; issues: Issue[] }) {
  const t = useT()
  const [text, setText] = useState(() => (value == null ? "" : JSON.stringify(value, null, 2)))
  const [bad, setBad] = useState(false)
  const mine = issues.filter((i) => i.path.startsWith(path))
  return (
    <div>
      <textarea aria-label={path} className={cn("field-input min-h-32 font-mono text-[12px]", (bad || mine.length > 0) && "border-danger")} value={text} spellCheck={false} dir="ltr" placeholder="(empty)"
        onChange={(e) => { setText(e.target.value); if (!e.target.value.trim()) { onChange(null); setBad(false); return } try { onChange(JSON.parse(e.target.value) as Json); setBad(false) } catch { setBad(true) } }} />
      {bad && <p className="mt-1 text-[12px] text-danger">{t("sf.badJson")}</p>}
      {mine.slice(0, 4).map((i) => <p key={i.path + i.message} className="mt-1 text-[12px] text-danger"><span dir="ltr">{i.path}</span>: {friendlyIssue(i.message, t)}</p>)}
    </div>
  )
}

/**
 * Renders a configuration payload as a form: scalars become typed inputs, nested objects become fieldsets, lists of
 * records fall back to an inline JSON editor. Validation is the same Zod schema the API uses (ch. 16.3 step 1).
 */
export function SchemaForm({ value, onChange, issues, path = "", depth = 0, selects }: { value: Json; onChange: (v: Json) => void; issues: Issue[]; path?: string; depth?: number; /** Fields with a closed set of values, by path. */ selects?: Record<string, readonly string[]> }) {
  const t = useT()
  if (!isObj(value)) return <JsonField value={value} onChange={onChange} path={path} issues={issues} />
  return (
    <div className={cn("grid gap-x-5 gap-y-4", depth === 0 ? "md:grid-cols-2 2xl:grid-cols-3" : "sm:grid-cols-2")}>
      {Object.entries(value).map(([k, v]) => {
        const p = path ? `${path}.${k}` : k
        const err = issues.find((i) => i.path === p)
        const set = (nv: Json) => onChange({ ...value, [k]: nv })
        const wrap = (control: React.ReactNode, wide = false) => (
          <label key={p} className={cn("block", wide && "sm:col-span-2 md:col-span-full")}>
            <span className={cn("cap", err && "text-danger")}>{label(k)}</span>
            <span className="mt-1 block">{control}</span>
            {err && <span className="mt-1 block text-[12px] text-danger">{friendlyIssue(err.message, t)}</span>}
          </label>
        )
        if (typeof v === "boolean") return <label key={p} className="flex items-center gap-2.5 self-end rounded-lg border border-rule bg-surface px-3 py-2 pointer-coarse:min-h-11"><input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} /><span>{label(k)}</span>{err && <span className="text-[12px] text-danger">{friendlyIssue(err.message, t)}</span>}</label>
        if (typeof v === "number") return wrap(<input type="number" step="any" className={cn("field-input num", err && "border-danger")} value={Number.isFinite(v) ? v : ""} onChange={(e) => set(e.target.value === "" ? Number.NaN : Number(e.target.value))} name={p} />)
        if (typeof v === "string" && selects?.[p]) return wrap(<NativeSelect className={cn("field-input", err && "border-danger")} value={v} onChange={(e) => set(e.target.value)} name={p}>{[...new Set([...selects[p]!, v])].map((o) => <option key={o} value={o}>{o}</option>)}</NativeSelect>)
        if (typeof v === "string") return wrap(<input className={cn("field-input", err && "border-danger")} value={v} onChange={(e) => set(e.target.value)} name={p} dir="auto" />)
        if (Array.isArray(v) && v.every((x) => typeof x === "number") && v.length === 2) return wrap(<span className="flex gap-1">{v.map((x, i) => <input key={i} type="number" className="field-input num" value={x as number} onChange={(e) => set(v.map((y, j) => (j === i ? Number(e.target.value) : y)) as Json)} aria-label={`${label(k)} ${i ? t("sf.to") : t("sf.from")}`} />)}</span>)
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) return wrap(<input className={cn("field-input font-mono", err && "border-danger")} value={(v as string[]).join(", ")} onChange={(e) => set(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} name={p} />, (v as string[]).join(", ").length > 40)
        if (Array.isArray(v) && v.every((x) => typeof x === "number")) return wrap(<input className="field-input num" value={(v as number[]).join(", ")} onChange={(e) => set(e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)))} name={p} />)
        if (isObj(v) && depth < 2 && Object.values(v).every((x) => !isObj(x) || depth < 1)) {
          return (
            <fieldset key={p} className="rounded-lg border border-rule bg-surface p-4 sm:col-span-2 md:col-span-full">
              <legend className="px-1.5 text-[12.5px] font-semibold text-ink">{label(k)}</legend>
              <SchemaForm value={v} onChange={set} issues={issues} path={p} depth={depth + 1} selects={selects} />
            </fieldset>
          )
        }
        return (
          <div key={p} className="sm:col-span-2 md:col-span-full">
            <p className="mb-1 cap">{label(k)} <span className="font-normal text-steel">{Array.isArray(v) ? `· ${t("sf.entries", { n: v.length })} · JSON` : "· JSON"}</span></p>
            <JsonField value={v} onChange={set} path={p} issues={issues} />
          </div>
        )
      })}
    </div>
  )
}

export function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  if (isObj(a as Json) && isObj(b as Json)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
    return [...keys].flatMap((k) => changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k))
  }
  return [path || "(root)"]
}
