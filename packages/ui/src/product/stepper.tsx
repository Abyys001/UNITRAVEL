import { Check } from "lucide-react"

import { cn } from "../lib/utils"

export interface Step { key: string; label: string }

/**
 * Request progress: where the customer is on a known path (received, review, quote, reserved, ticketed). `current` is an
 * index; steps before it are done. Horizontal from `sm`, vertical on phones. State is text (`done` / `current` / `to do`
 * supplied by the caller for the screen reader), never colour alone.
 */
export function Stepper({ steps, current, labels, label, className }: { steps: Step[]; current: number; labels: { done: string; current: string; todo: string }; label: string; className?: string }) {
  return (
    <ol aria-label={label} data-testid="stepper" className={cn("flex flex-col gap-3 sm:flex-row sm:gap-0", className)}>
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo"
        return (
          <li key={s.key} aria-current={state === "current" ? "step" : undefined} data-state={state} className="relative flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2 sm:text-center">
            {i > 0 && <span aria-hidden className={cn("absolute hidden sm:block top-4 -translate-y-1/2 border-t-2 end-1/2 w-full", i <= current ? "border-navy-900" : "border-dashed border-haze")} />}
            <span aria-hidden className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold", state === "done" && "bg-navy-900 text-white", state === "current" && "bg-orange text-navy-950 ring-4 ring-orange/25", state === "todo" && "border-2 border-haze bg-white text-steel")}>
              {state === "done" ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn("text-sm leading-tight", state === "current" ? "font-bold text-navy-950" : state === "done" ? "font-medium text-navy-900" : "text-steel")}>
              {s.label}
              <span className="sr-only"> ({labels[state]})</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
