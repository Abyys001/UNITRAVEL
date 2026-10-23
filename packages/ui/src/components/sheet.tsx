// Adapted from shadcn/ui (MIT) apps/v4/registry/bases/base/ui/sheet.tsx@98a1fe67b439324ddc857f47fbdce056600a4329
"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "../lib/utils"
import { Button } from "./button"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * "start"/"end" are logical (flip with dir="rtl"); "left"/"right" are physical
 * and never flip, for callers that need a fixed screen edge regardless of direction.
 */
type SheetSide = "top" | "right" | "bottom" | "left" | "start" | "end"

const sheetSideClasses: Record<SheetSide, string> = {
  top: "inset-x-0 top-0 h-auto border-b data-closed:slide-out-to-top data-open:slide-in-from-top",
  bottom:
    "inset-x-0 bottom-0 h-auto border-t data-closed:slide-out-to-bottom data-open:slide-in-from-bottom",
  right:
    "inset-y-0 right-0 h-full w-3/4 border-l rounded-s-lg data-closed:slide-out-to-right data-open:slide-in-from-right sm:max-w-sm",
  left: "inset-y-0 left-0 h-full w-3/4 border-r rounded-e-lg data-closed:slide-out-to-left data-open:slide-in-from-left sm:max-w-sm",
  end: "inset-y-0 end-0 h-full w-3/4 border-s rounded-s-lg data-closed:ltr:slide-out-to-right data-closed:rtl:slide-out-to-left data-open:ltr:slide-in-from-right data-open:rtl:slide-in-from-left sm:max-w-sm",
  start:
    "inset-y-0 start-0 h-full w-3/4 border-e rounded-e-lg data-closed:ltr:slide-out-to-left data-closed:rtl:slide-out-to-right data-open:ltr:slide-in-from-left data-open:rtl:slide-in-from-right sm:max-w-sm",
}

function SheetContent({
  className,
  children,
  side = "end",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: SheetSide
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover text-popover-foreground shadow-lg outline-none duration-200 ease-in-out data-closed:animate-out data-closed:duration-300 data-open:animate-in data-open:duration-500",
          sheetSideClasses[side],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" size="icon-sm" />}
            className="absolute top-4 end-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-body text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
