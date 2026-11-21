import { PortalShell } from "@/components/portal/shell"

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PortalShell optional>{children}</PortalShell>
}
