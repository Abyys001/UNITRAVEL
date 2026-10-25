// Adapted from shadcn/ui (MIT) apps/v4/registry/new-york-v4/lib/utils.ts@98a1fe67b439324ddc857f47fbdce056600a4329
import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Semantic type-scale names (console scale in apps/console/src/app/globals.css: 2xs … display). Without this tailwind-merge
// reads `text-display` as a text colour, so a later `text-ink` would silently drop the size (and vice versa).
const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["2xs", "caption", "meta", "body", "lead", "section", "title", "display"] }] } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
