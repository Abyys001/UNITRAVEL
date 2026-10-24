import { AlertTriangle, Inbox } from "lucide-react"

import { IconBadge } from "../brand/art"
import { Button } from "../components/button"
import { cn } from "../lib/utils"

/** Loading: a shimmer block that announces itself. `label` is read by screen readers, never shown. */
export function LoadingState({ label, rows = 3, className }: { label: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn("space-y-3", className)} data-testid="loading-state">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => <div key={i} aria-hidden className="shimmer h-14 rounded-2xl" />)}
    </div>
  )
}

/** Empty: say what is missing and what to do about it. */
export function EmptyState({ title, body, action, icon, compact = false, className }: { title: React.ReactNode; body?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "gap-1 py-4" : "card-brand gap-2 p-8 md:p-10", className)} data-testid="empty-state">
      {!compact && <IconBadge className="mb-1">{icon ?? <Inbox />}</IconBadge>}
      <p className="text-steel">{title}</p>
      {body && <p className="max-w-md text-sm text-steel">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/** Error: plain words plus a retry. `role=alert` so it is announced when it replaces content. */
export function ErrorState({ title, body, retryLabel, onRetry, compact = false, className }: { title: React.ReactNode; body?: React.ReactNode; retryLabel?: string; onRetry?: () => void; compact?: boolean; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-2 text-center", compact ? "py-4" : "card-brand border-danger/40 p-8", className)} data-testid="error-state">
      {!compact && <span aria-hidden className="mb-2 grid size-12 place-items-center rounded-full bg-danger-subtle text-danger"><AlertTriangle className="size-6" /></span>}
      <p className={cn(compact ? "text-danger" : "font-display text-xl")}>{title}</p>
      {body && <p className="max-w-md text-sm text-steel">{body}</p>}
      {onRetry && retryLabel && <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  )
}
