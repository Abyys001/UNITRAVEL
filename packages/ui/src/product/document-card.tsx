import { FileText } from "lucide-react"

import { cn } from "../lib/utils"

/**
 * A downloadable or reviewable document: icon, name, meta line, an optional status badge and actions. Used for tickets,
 * invoices, quotations and passport scans. Actions are passed in so the card stays free of routing and download logic.
 */
export function DocumentCard({ title, meta, status, actions, icon, tone = "default", className, "data-testid": testId }: { title: React.ReactNode; meta?: React.ReactNode; status?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; tone?: "default" | "success"; className?: string; "data-testid"?: string }) {
  return (
    <div data-testid={testId} className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm", tone === "success" ? "border-success/40 bg-success-subtle" : "border-line bg-white", className)}>
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-navy-900 [&_svg]:size-5">{icon ?? <FileText />}</span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-semibold [overflow-wrap:anywhere]">{title}</p>
        {meta && <p className="text-xs text-steel">{meta}</p>}
      </div>
      {status}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
