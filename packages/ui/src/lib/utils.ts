// Adapted from shadcn/ui (MIT) apps/v4/registry/new-york-v4/lib/utils.ts@98a1fe67b439324ddc857f47fbdce056600a4329
import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The kit primitives use semantic type-scale names (`text-body`, `text-caption`); without this tailwind-merge reads
// them as text colours and drops the variant's foreground colour.
const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["body", "caption"] }] } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
