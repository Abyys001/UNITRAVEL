"use client"

import { useEffect, useState } from "react"

/**
 * Decorative looping background video. The poster is always rendered (it is the LCP element); the video only
 * mounts when the visitor has not asked for reduced motion or reduced data — many customers are on slow or
 * filtered connections (DESIGN.md).
 */
export function HeroVideo({ name, className = "" }: { name: string; className?: string }) {
  const [play, setPlay] = useState(false)
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
    setPlay(!reduced && !saveData)
  }, [])
  return (
    <div aria-hidden className={`absolute inset-0 overflow-hidden ${className}`}>
      <picture>
        <source srcSet={`/media/video/${name}-poster.webp`} type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element -- static poster, sized by CSS cover */}
        <img src={`/media/video/${name}-poster.jpg`} alt="" fetchPriority="high" className="size-full object-cover" />
      </picture>
      {play && (
        <video autoPlay muted loop playsInline preload="metadata" poster={`/media/video/${name}-poster.jpg`} className="absolute inset-0 size-full object-cover">
          <source src={`/media/video/${name}.webm`} type="video/webm" />
          <source src={`/media/video/${name}.mp4`} type="video/mp4" />
        </video>
      )}
    </div>
  )
}
