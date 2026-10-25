"use client"

/**
 * Console controls on native elements (docs/design/DESIGN.md "Control deck v2"):
 *   <Tip label side>          tooltip for icon-only controls; shows on hover and keyboard focus, Esc hides; the child keeps
 *                             its own accessible name (aria-label), the bubble is aria-hidden so names are never read twice
 *   <Switch checked onChange label>   <input type="checkbox" role="switch"> with a fixed label — the control never moves
 *   <Segmented label value options onChange>   radio group: one tab stop, arrow keys move and select, mirrored in RTL
 *   <Check label />            labelled native checkbox with the stable box from globals.css
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

type Side = "right" | "bottom" | "top" | "left"

export function Tip({ label, side = "bottom", children, disabled }: { label: React.ReactNode; side?: Side; children: React.ReactElement<React.HTMLAttributes<HTMLElement>>; disabled?: boolean }) {
  const [pos, setPos] = useState<{ x: number; y: number; side: Side } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = useCallback((el: HTMLElement, delay: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
      const rtl = document.documentElement.dir === "rtl"
      const s: Side = side === "right" && rtl ? "left" : side === "left" && rtl ? "right" : side
      const gap = 8
      setPos(s === "right" ? { x: r.right + gap, y: r.top + r.height / 2, side: s } : s === "left" ? { x: r.left - gap, y: r.top + r.height / 2, side: s }
        : s === "top" ? { x: r.left + r.width / 2, y: r.top - gap, side: s } : { x: r.left + r.width / 2, y: r.bottom + gap, side: s })
    }, delay)
  }, [side])
  const hide = useCallback(() => { clearTimeout(timer.current); setPos(null) }, [])
  useEffect(() => {
    if (!pos) return
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") hide() }
    window.addEventListener("keydown", k)
    window.addEventListener("scroll", hide, true)
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("scroll", hide, true) }
  }, [pos, hide])
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!isValidElement(children)) return children
  const p = children.props
  const child = cloneElement(children, {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { p.onMouseEnter?.(e); if (!disabled) show(e.currentTarget, 350) },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { p.onMouseLeave?.(e); hide() },
    onFocus: (e: React.FocusEvent<HTMLElement>) => { p.onFocus?.(e); if (!disabled && e.currentTarget.matches(":focus-visible")) show(e.currentTarget, 0) },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { p.onBlur?.(e); hide() },
    onClick: (e: React.MouseEvent<HTMLElement>) => { p.onClick?.(e); hide() },
  })
  const transform = pos?.side === "right" ? "translate(0,-50%)" : pos?.side === "left" ? "translate(-100%,-50%)" : pos?.side === "top" ? "translate(-50%,-100%)" : "translate(-50%,0)"
  return (
    <>
      {child}
      {pos && !disabled && <span aria-hidden className="tip-bubble" style={{ left: pos.x, top: pos.y, transform }}>{label}</span>}
    </>
  )
}

export function Switch({ checked, onChange, label, description, disabled, className, testId }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean; className?: string; testId?: string }) {
  const id = useId()
  return (
    <label htmlFor={id} className={cn("inline-flex min-h-control cursor-pointer items-center gap-2.5 select-none", disabled && "cursor-not-allowed opacity-60", className)}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={description ? `${id}-d` : undefined} data-testid={testId} />
      <span className="flex flex-col leading-tight">
        <span className="font-medium">{label}</span>
        {description && <span id={`${id}-d`} className="text-caption text-steel">{description}</span>}
      </span>
    </label>
  )
}

export function Check({ label, className, ...input }: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex min-h-control cursor-pointer items-center gap-2 select-none", input.disabled && "cursor-not-allowed opacity-60", className)}>
      <input type="checkbox" {...input} />
      <span>{label}</span>
    </label>
  )
}

export function Segmented<V extends string>({ label, value, options, onChange, size = "md", hideLabel, className }: { label: string; value: V; options: { value: V; label: React.ReactNode; icon?: React.ReactNode }[]; onChange: (v: V) => void; size?: "sm" | "md"; hideLabel?: boolean; className?: string }) {
  const id = useId()
  return (
    <div className={className}>
      {!hideLabel && <p id={id} className="cap mb-1.5">{label}</p>}
      <div role="radiogroup" aria-labelledby={hideLabel ? undefined : id} aria-label={hideLabel ? label : undefined} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-[9px] bg-surface-sunk p-0.5 ring-1 ring-rule ring-inset" onKeyDown={(e) => {
        const i = options.findIndex((o) => o.value === value)
        const rtl = document.documentElement.dir === "rtl"
        const step = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0
        if (!step) return
        e.preventDefault()
        const group = e.currentTarget
        onChange(options[(i + step + options.length) % options.length]!.value)
        requestAnimationFrame(() => group.querySelector<HTMLElement>("[aria-checked=true]")?.focus())
      }}>
        {options.map((o) => {
          const on = value === o.value
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onChange(o.value)}
              className={cn("inline-flex items-center justify-center gap-1.5 rounded-[7px] px-2.5 font-medium transition-colors pointer-coarse:min-h-11 [&_svg]:size-4",
                size === "sm" ? "min-h-7 text-meta" : "min-h-8 text-meta",
                on ? "bg-surface-raised text-ink shadow-[var(--shadow-xs)] ring-1 ring-rule-strong" : "text-steel hover:text-ink")}>
              {o.icon}{o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
