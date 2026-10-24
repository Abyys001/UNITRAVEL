"use client"

import { Camera, ExternalLink, Film } from "lucide-react"

import { IconBadge } from "@unitravel/ui/brand/art"

import { Ltr } from "@/components/badges"
import { useI18n } from "@/lib/i18n"

interface Credit { kind: "video" | "photo"; en: string; fa: string; author: string; licence: "Pexels" | "Unsplash"; source: string }

// Transcribed from apps/web/public/media/CREDITS.md (sourced 2026-10-23); keep in step with that file.
const CREDITS: Credit[] = [
  { kind: "video", en: "Aircraft wing over the clouds at dusk", fa: "بال هواپیما بالای ابرها در غروب", author: "MissDeena Travels", licence: "Pexels", source: "https://www.pexels.com/video/an-aircraft-wing-9525409/" },
  { kind: "video", en: "Sunset over an airport apron and runway", fa: "غروب بر فراز باند و محوطهٔ فرودگاه", author: "Hacıilyas Sever", licence: "Pexels", source: "https://www.pexels.com/video/the-sun-sets-over-an-airport-runway-19202918/" },
  { kind: "photo", en: "Ortaköy Mosque and the Bosphorus Bridge at sunset", fa: "مسجد اورتاکوی و پل بسفر در غروب", author: "Spenser Sembrat", licence: "Unsplash", source: "https://unsplash.com/photos/O1n-f15L668" },
  { kind: "photo", en: "Yerevan at dusk with Mount Ararat", fa: "ایروان در گرگ‌ومیش با کوه آرارات", author: "Aleksandr Popov", licence: "Unsplash", source: "https://unsplash.com/photos/OfRkyh3xYoI" },
  { kind: "photo", en: "Tower Bridge and the Thames toward Canary Wharf", fa: "نمای هوایی تاور بریج و تایمز به سوی کنری وارف", author: "Sander Crombach", licence: "Unsplash", source: "https://unsplash.com/photos/6b3r1WAjPBI" },
  { kind: "photo", en: "Tehran with Milad Tower and the Alborz foothills", fa: "نمای هوایی تهران با برج میلاد و دامنهٔ البرز", author: "KAMRAN gholami", licence: "Unsplash", source: "https://unsplash.com/photos/qNZJc3V9R2A" },
  { kind: "photo", en: "Sultan Qaboos Grand Mosque, Muscat", fa: "مسجد بزرگ سلطان قابوس، مسقط", author: "Daniele Levis Pelusi", licence: "Unsplash", source: "https://unsplash.com/photos/xbLE8qOTPoY" },
  { kind: "photo", en: "Tbilisi old town at blue hour", fa: "بافت قدیم تفلیس در ساعت آبی", author: "Viktor SOLOMONIK", licence: "Unsplash", source: "https://unsplash.com/photos/K_ZHR_uNY30" },
  { kind: "photo", en: "Empty main-deck hold of a freighter", fa: "انبار خالی عرشهٔ اصلی هواپیمای باری", author: "Ramaz Bluashvili", licence: "Pexels", source: "https://www.pexels.com/photo/interior-view-of-an-empty-cargo-plane-32509735/" },
  { kind: "photo", en: "Silhouette of a traveller at a terminal window", fa: "سایهٔ مسافری کنار پنجرهٔ ترمینال", author: "Alex Alvarez", licence: "Unsplash", source: "https://unsplash.com/photos/ltCNpYiJPRg" },
]

export default function CreditsPage() {
  const { t, locale } = useI18n()
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("credits.title")}</h1>
      <span aria-hidden className="mt-4 block h-1 w-16 rounded-full bg-orange" />
      <p className="mt-5 max-w-2xl leading-7 text-steel">{t("credits.lead")}</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {CREDITS.map((c) => (
          <li key={c.source} className="card-brand flex gap-4 p-5">
            <IconBadge className="size-11">{c.kind === "video" ? <Film /> : <Camera />}</IconBadge>
            <dl className="min-w-0 text-sm">
              <dt className="sr-only">{t("credits.item")}</dt>
              <dd className="font-display text-base leading-snug">{locale === "fa" ? c.fa : c.en}</dd>
              <dt className="mt-2 inline text-steel">{t("credits.creator")}: </dt>
              <dd className="inline font-semibold"><Ltr>{c.author}</Ltr></dd>
              <div className="mt-1">
                <dt className="inline text-steel">{t("credits.licence")}: </dt>
                <dd className="inline">{c.licence}</dd>
              </div>
              <div className="mt-2">
                <dt className="sr-only">{t("credits.source")}</dt>
                <dd><a href={c.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-royal underline underline-offset-4 hover:text-navy-950">{c.licence}<ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden /></a></dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}
