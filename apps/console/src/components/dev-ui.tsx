import { cn } from "@unitravel/ui/lib/utils"

import { TableScroll } from "@/components/case"

/** Layout primitives shared by the Developer Panel pages: a padded page body, a titled card, key/value rows, a status dot. */

export const DevPage = ({ children, className, ...rest }: React.ComponentProps<"div">) => <div className={cn("space-y-4 px-4 py-4 md:px-6", className)} {...rest}>{children}</div>

/** Titled card. `flush` removes the body padding so a table can run edge to edge. */
export function Section({ title, hint, aside, flush, children, className, ...rest }: Omit<React.ComponentProps<"section">, "title"> & { title: React.ReactNode; hint?: React.ReactNode; aside?: React.ReactNode; flush?: boolean }) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-xl border border-rule bg-surface-raised shadow-[var(--tile-shadow)]", className)} {...rest}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3 md:px-5">
        <div className="min-w-0"><h2 className="text-[14px] font-semibold text-ink">{title}</h2>{hint && <p className="mt-0.5 text-[12px] text-steel">{hint}</p>}</div>
        {aside && <div className="flex flex-wrap items-center gap-2 text-[12px]">{aside}</div>}
      </header>
      <div className={flush ? undefined : "p-4 md:p-5"}>{children}</div>
    </section>
  )
}

/** Table inside a flush Section: horizontal scroll on narrow screens, shared `.data-table` look. */
export const DataTable = ({ children, ...rest }: React.ComponentProps<"table">) => <TableScroll><table className="data-table w-full" {...rest}>{children}</table></TableScroll>

/** Label / value rows with hairlines; values are plain text unless the caller marks them `num` or mono. */
export const KV = ({ children, className, ...rest }: React.ComponentProps<"dl">) => <dl className={cn("divide-y divide-rule", className)} {...rest}>{children}</dl>
export const KVRow = ({ k, children, className }: { k: React.ReactNode; children: React.ReactNode; className?: string }) => <div className={cn("flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0", className)}><dt className="text-steel">{k}</dt><dd className="min-w-0 text-end">{children}</dd></div>

export function Dot({ ok, label }: { ok: boolean | null; label: string }) {
  return <span role="img" aria-label={label} className={cn("inline-block size-2 shrink-0 rounded-full", ok === null ? "bg-steel/40" : ok ? "bg-success" : "bg-danger")} />
}
