"use client"

import { Headset, Hotel, Luggage, type LucideIcon, MapPin, Play, Plane, Search, Smartphone } from "lucide-react"
import Link from "next/link"
import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react"

import { useI18n } from "@/lib/i18n"

const EDGE_LAYERS = 14
const ADVANCE_MS = 3800

/** A real 3D body: stacked layers give it thickness, so the side of the phone shows as it turns. */
export function Phone3D({ screen, alt, screens }: { screen: number; alt: string; screens: string[] }) {
  return (
    <div className="phone3d-float">
      <div className="phone3d-body">
        {Array.from({ length: EDGE_LAYERS }, (_, i) => <span key={i} className="phone3d-edge" style={{ "--i": i + 1 } as CSSProperties} />)}
        <span className="phone3d-key phone3d-key-a" />
        <span className="phone3d-key phone3d-key-b" />
        <div className="phone3d-front">
          <div className="phone3d-screen" dir="ltr">
            {screens.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- real app screens, already sized for this frame
              <img key={src} src={src} alt={i === screen ? alt : ""} aria-hidden={i !== screen} width={780} height={1688} decoding="async" className={i === screen ? "is-on" : undefined} />
            ))}
            <span className="phone3d-island" />
            <span className="phone3d-glare" />
          </div>
        </div>
      </div>
    </div>
  )
}

const FEATURES: { icon: LucideIcon; label: "home.appFeat1" | "home.appFeat2" | "home.appFeat3"; shot: string }[] = [
  { icon: Search, label: "home.appFeat1", shot: "search" },
  { icon: Smartphone, label: "home.appFeat2", shot: "services" },
  { icon: Hotel, label: "home.appFeat3", shot: "hotels" },
]

/** The phone with its motion graphics: orbit rings, a flight path and feature chips that follow the screen on show. */
export function AppShowcase({ className = "", large = false, drifters = false }: { className?: string; large?: boolean; drifters?: boolean }) {
  const { t, locale } = useI18n()
  const [active, setActive] = useState(0)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = setInterval(() => setActive((a) => (a + 1) % FEATURES.length), ADVANCE_MS)
    return () => clearInterval(timer)
  }, [])

  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !stage.current) return
    const r = stage.current.getBoundingClientRect()
    stage.current.style.setProperty("--tilt-y", `${((e.clientX - r.left) / r.width - 0.5) * 22}deg`)
    stage.current.style.setProperty("--tilt-x", `${((e.clientY - r.top) / r.height - 0.5) * -12}deg`)
  }
  const level = () => {
    stage.current?.style.setProperty("--tilt-y", "0deg")
    stage.current?.style.setProperty("--tilt-x", "0deg")
  }
  const label = t(FEATURES[active]!.label)

  return (
    <div ref={stage} onPointerMove={tilt} onPointerLeave={level} className={`phone3d-stage ${large ? "phone3d-large" : ""} ${className}`} data-testid="app-showcase">
      <svg aria-hidden viewBox="0 0 600 600" className="phone3d-rings" fill="none">
        <circle cx="300" cy="300" r="170" stroke="currentColor" strokeOpacity=".28" strokeDasharray="2 12" strokeLinecap="round" strokeWidth="2" />
        <circle cx="300" cy="300" r="240" stroke="currentColor" strokeOpacity=".2" />
        <circle cx="300" cy="300" r="292" stroke="currentColor" strokeOpacity=".14" strokeDasharray="1 16" strokeLinecap="round" strokeWidth="2" />
        <circle cx="540" cy="300" r="7" fill="#ff8a1f" />
        <circle cx="60" cy="300" r="4" fill="#11b7ff" />
      </svg>
      <svg aria-hidden viewBox="0 0 600 600" className="phone3d-route" fill="none">
        <path className="phone3d-route-line" d="M -10 470 C 150 300, 300 610, 610 120" stroke="#ffac50" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 14" />
      </svg>
      {drifters && <Drifters />}
      <div className="phone3d-tilt">
        <Phone3D screen={active} alt={t("appPage.screenAlt", { feature: label })} screens={FEATURES.map((f) => `/media/app/screens/${f.shot}-${locale}.webp`)} />
      </div>
      <ul className="phone3d-chips">
        {FEATURES.map((f, i) => (
          <li key={f.label} className={i === active ? "is-on" : undefined}><f.icon aria-hidden className="size-4 shrink-0" />{t(f.label)}</li>
        ))}
      </ul>
    </div>
  )
}

const DRIFTERS: { icon: LucideIcon; pos: string }[] = [
  { icon: Smartphone, pos: "phone3d-drift-a" },
  { icon: Plane, pos: "phone3d-drift-b" },
  { icon: MapPin, pos: "phone3d-drift-c" },
  { icon: Luggage, pos: "phone3d-drift-d" },
  { icon: Headset, pos: "phone3d-drift-e" },
]

/** Small icons floating in the space around the phone. Decoration only, so hidden from assistive technology. */
function Drifters() {
  return <>{DRIFTERS.map(({ icon: Icon, pos }) => <span key={pos} aria-hidden className={`phone3d-drifter ${pos}`}><Icon className="size-full" /></span>)}</>
}

const TEASER_BUTTON = "btn-orange phone3d-cta gap-3 px-8 py-4 text-lg md:px-10 md:py-5 md:text-xl"

export function WatchTeaserLink({ href, label, testId }: { href: string; label: string; testId: string }) {
  return (
    <Link href={href} data-testid={testId} className={TEASER_BUTTON}>
      <Play aria-hidden className="size-6 fill-current" />{label}
    </Link>
  )
}

export function WatchTeaserButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-testid="app-watch" className={TEASER_BUTTON}>
      <Play aria-hidden className="size-6 fill-current" />{label}
    </button>
  )
}
