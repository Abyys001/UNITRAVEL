"use client"

// Adapted from the engineering kit components/web/motion (reveal.tsx + use-in-view.ts).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"

import { cn } from "../lib/utils"

/** True once the element has entered the viewport. */
export function useInView<T extends Element>({ rootMargin = "0px 0px -12% 0px" } = {}) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setInView(true); observer.disconnect() }
    }, { rootMargin })
    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin])
  return [ref, inView] as const
}

/**
 * Fades children in once visible. Content stays visible without JS and under reduced motion:
 * the hidden state only applies while `data-reveal="pending"` (styles.css).
 */
export function Reveal({ children, className, delay = 0, variant = "up", as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; variant?: "up" | "scale" | "fade"; as?: "div" | "section" | "li" | "article" }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <Tag ref={ref as never} data-reveal={inView ? "done" : "pending"} data-variant={variant} className={cn("reveal-io", className)} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  )
}
