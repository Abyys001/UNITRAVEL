"use client"

import { cn } from "@unitravel/ui/lib/utils"

/**
 * Section primitives for case detail pages (admin requests and service requests): every block is a raised card on the
 * sunk page background, with an icon, an h2, an optional description and an aside action. Semantic tokens only.
 */

type IconType = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>

export function CaseSection({ id, icon: Icon, title, description, aside, count, className, children, ...rest }: {
  id: string; icon?: IconType; title: React.ReactNode; description?: React.ReactNode; aside?: React.ReactNode; count?: number; className?: string; children: React.ReactNode
} & Omit<React.ComponentProps<"section">, "title" | "id">) {
  return (
    <section {...rest} id={id} aria-labelledby={`${id}-h`} className={cn("min-w-0 scroll-mt-32 rounded-[var(--radius-card)] border border-rule bg-surface-raised shadow-[var(--shadow-xs)]", className)}>
      <header className="flex items-start gap-3 border-b border-rule px-4 py-3 md:px-5">
        {Icon && <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-info-subtle text-royal"><Icon className="size-4" aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-h`} className="flex items-baseline gap-2 text-lead font-semibold text-ink">{title}{count !== undefined && <span className="num text-meta font-medium text-steel">{count}</span>}</h2>
          {description && <p className="mt-0.5 text-meta text-steel">{description}</p>}
        </div>
        {aside && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{aside}</div>}
      </header>
      {/* Panels from other components render as sub-blocks: the first one drops its rule and top padding. */}
      <div className="space-y-4 px-4 py-4 md:px-5 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0">{children}</div>
    </section>
  )
}

/** Small heading inside a section, for a group of related records. */
export function SubHead({ children, aside, className, ...rest }: { children: React.ReactNode; aside?: React.ReactNode } & React.ComponentProps<"div">) {
  return (
    <div {...rest} className={cn("flex items-center justify-between gap-2", className)}>
      <h3 className="cap">{children}</h3>
      {aside}
    </div>
  )
}

/** Label-above-value facts in a responsive grid. */
export function FactGrid({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode; wide?: boolean }[]; className?: string }) {
  return (
    // Fluid columns with no filler: a short last row never leaves an empty block.
    <dl className={cn("grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] overflow-hidden rounded-md border border-rule bg-surface-sunk", className)}>
      {items.map((f, i) => (
        <div key={i} className={cn("min-w-0 border-rule px-3 py-2.5 shadow-[inset_-1px_-1px_0_var(--rule)] rtl:shadow-[inset_1px_-1px_0_var(--rule)]", f.wide && "col-span-2")}>
          <dt className="cap">{f.label}</dt>
          <dd className="mt-0.5 font-medium text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Chip row of real anchor links to the sections below; scrolls sideways on phones, wraps from lg up. */
export function SectionNav({ items, label, className }: { items: { id: string; label: React.ReactNode; icon?: IconType; count?: number }[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <ul className="flex gap-1.5 overflow-x-auto px-3 py-2 md:px-0 md:py-0 lg:flex-wrap lg:overflow-visible [scrollbar-width:thin]">
        {items.map(({ id, label: text, icon: Icon, count }) => (
          <li key={id} className="shrink-0">
            <a href={`#${id}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rule bg-surface-raised px-3 text-meta font-medium whitespace-nowrap text-ink transition-colors hover:border-rule-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal">
              {Icon && <Icon className="size-3.5 text-steel" aria-hidden />}
              {text}
              {count !== undefined && count > 0 && <span className="num text-steel">{count}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
