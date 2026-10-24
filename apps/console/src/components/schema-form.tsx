"use client"

import { useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
export type Issue = { path: string; message: string }

const label = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v)

function JsonField({ value, onChange, path, issues }: { value: Json; onChange: (v: Json) => void; path: string; issues: Issue[] }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [bad, setBad] = useState(false)
  const mine = issues.filter((i) => i.path.startsWith(path))
  return (
    <div>
      <textarea aria-label={path} className={cn("field-input min-h-28 font-mono text-[11.5px]", (bad || mine.length > 0) && "border-danger")} value={text} spellCheck={false}
        onChange={(e) => { setText(e.target.value); try { onChange(JSON.parse(e.target.value) as Json); setBad(false) } catch { setBad(true) } }} />
      {bad && <p className="text-[11px] text-danger">Not valid JSON yet</p>}
      {mine.slice(0, 4).map((i) => <p key={i.path + i.message} className="text-[11px] text-danger">{i.path}: {i.message}</p>)}
    </div>
  )
}

/**
 * Renders a configuration payload as a form: scalars become typed inputs, nested objects become fieldsets, lists of
 * records fall back to an inline JSON editor. Validation is the same Zod schema the API uses (ch. 16.3 step 1).
 */
export function SchemaForm({ value, onChange, issues, path = "", depth = 0 }: { value: Json; onChange: (v: Json) => void; issues: Issue[]; path?: string; depth?: number }) {
  if (!isObj(value)) return <JsonField value={value} onChange={onChange} path={path} issues={issues} />
  return (
    <div className={cn("grid gap-x-4 gap-y-2", depth === 0 ? "md:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2")}>
      {Object.entries(value).map(([k, v]) => {
        const p = path ? `${path}.${k}` : k
        const err = issues.find((i) => i.path === p)
        const set = (nv: Json) => onChange({ ...value, [k]: nv })
        const wrap = (control: React.ReactNode, wide = false) => (
          <label key={p} className={cn("block", wide && "sm:col-span-2 md:col-span-full")}>
            <span className={cn("cap", err && "text-danger")}>{label(k)}</span>
            <span className="mt-0.5 block">{control}</span>
            {err && <span className="text-[11px] text-danger">{err.message}</span>}
          </label>
        )
        if (typeof v === "boolean") return <label key={p} className="flex items-center gap-2 self-end pb-1.5"><input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} /><span>{label(k)}</span>{err && <span className="text-[11px] text-danger">{err.message}</span>}</label>
        if (typeof v === "number") return wrap(<input type="number" step="any" className={cn("field-input num", err && "border-danger")} value={Number.isFinite(v) ? v : ""} onChange={(e) => set(e.target.value === "" ? Number.NaN : Number(e.target.value))} name={p} />)
        if (typeof v === "string") return wrap(<input className={cn("field-input", err && "border-danger")} value={v} onChange={(e) => set(e.target.value)} name={p} dir="auto" />)
        if (Array.isArray(v) && v.every((x) => typeof x === "number") && v.length === 2) return wrap(<span className="flex gap-1">{v.map((x, i) => <input key={i} type="number" className="field-input num" value={x as number} onChange={(e) => set(v.map((y, j) => (j === i ? Number(e.target.value) : y)) as Json)} aria-label={`${label(k)} ${i ? "to" : "from"}`} />)}</span>)
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) return wrap(<input className={cn("field-input font-mono", err && "border-danger")} value={(v as string[]).join(", ")} onChange={(e) => set(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} name={p} />, (v as string[]).join(", ").length > 40)
        if (Array.isArray(v) && v.every((x) => typeof x === "number")) return wrap(<input className="field-input num" value={(v as number[]).join(", ")} onChange={(e) => set(e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)))} name={p} />)
        if (isObj(v) && depth < 2 && Object.values(v).every((x) => !isObj(x) || depth < 1)) {
          return (
            <fieldset key={p} className="rounded-md border border-rule bg-surface-raised p-2.5 sm:col-span-2 md:col-span-full">
              <legend className="cap px-1">{label(k)}</legend>
              <SchemaForm value={v} onChange={set} issues={issues} path={p} depth={depth + 1} />
            </fieldset>
          )
        }
        return (
          <div key={p} className="sm:col-span-2 md:col-span-full">
            <p className="cap">{label(k)} <span className="normal-case text-steel">{Array.isArray(v) ? `· ${v.length} entries · JSON` : "· JSON"}</span></p>
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
