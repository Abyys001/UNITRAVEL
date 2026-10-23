// Adapted from shadcn/ui (MIT) apps/v4/registry/bases/base/ui/badge.tsx@98a1fe67b439324ddc857f47fbdce056600a4329
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-2 py-0.5 text-caption font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-neutral-border bg-neutral-subtle text-neutral-subtle-fg",
        info: "border-info-border bg-info-subtle text-info-subtle-fg",
        success: "border-success-border bg-success-subtle text-success-subtle-fg",
        warning: "border-warning-border bg-warning-subtle text-warning-subtle-fg",
        danger: "border-danger-border bg-danger-subtle text-danger-subtle-fg",
        brand: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        outline: "border-border bg-transparent text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Badge({
  className,
  variant = "neutral",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
