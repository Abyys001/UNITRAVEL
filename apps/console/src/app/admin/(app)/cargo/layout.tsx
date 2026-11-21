"use client"

import { EmptyState } from "@/components/bento"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** The API refuses these routes without cargo_request.read.any (an agent gets 403); say so instead of loading forever. */
export default function CargoLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession()
  const t = useT()
  if (!can("cargo_request.read.any")) return <div className="p-6"><EmptyState title={t("ops.noAccess")} /></div>
  return <>{children}</>
}
