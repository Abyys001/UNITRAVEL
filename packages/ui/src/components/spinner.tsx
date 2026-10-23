// Adapted from shadcn/ui (MIT) apps/v4/registry/bases/base/ui/spinner.tsx@98a1fe67b439324ddc857f47fbdce056600a4329
import { Loader2Icon } from "lucide-react"

import { cn } from "../lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
