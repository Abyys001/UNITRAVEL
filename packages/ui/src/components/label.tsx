// Adapted from shadcn/ui (MIT) apps/v4/registry/bases/base/ui/label.tsx@98a1fe67b439324ddc857f47fbdce056600a4329
"use client"

import * as React from "react"

import { cn } from "../lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-body leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
