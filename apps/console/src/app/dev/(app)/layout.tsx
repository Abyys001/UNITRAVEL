import { DevFrame } from "@/components/dev-frame"

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DevFrame>{children}</DevFrame>
}
