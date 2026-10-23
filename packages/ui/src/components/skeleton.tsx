// Adapted from shadcn/ui (MIT) apps/v4/registry/bases/base/ui/skeleton.tsx@98a1fe67b439324ddc857f47fbdce056600a4329
import { cn } from "../lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
