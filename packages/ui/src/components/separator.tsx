// Adapted from shadcn/ui (MIT) apps/v4/registry/bases/base/ui/separator.tsx@98a1fe67b439324ddc857f47fbdce056600a4329
"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "../lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:h-full data-vertical:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
