import { NativeSelect } from "../components/native-select"
import { cn } from "../lib/utils"

// Files in each app's public/flags (kit circle-flags, MIT). A code outside this set shows its text without a flag rather than a broken image.
const FLAGS = new Set("ae af am at au az be bh ca ch cn de dk es eu fr gb ge hk in iq ir it jp kr kw my nl no nz om pk qa ru sa se sg th tr us".split(" "))

/** Decorative: a flag always sits beside its country's name or code, so screen readers skip it. SVG files because Windows has no emoji flags. */
export function CountryFlag({ code, size = 16, className }: { code: string; size?: number; className?: string }) {
  const flag = code.toLowerCase()
  if (!FLAGS.has(flag)) return null
  return <img src={`/flags/${flag}.svg`} width={size} height={size} alt="" loading="lazy" decoding="async" className={cn("inline-block shrink-0 rounded-full", className)} />
}

/** A flag followed by the country's name, or by its ISO code when no name is passed. */
export function Country({ code, children, className }: { code: string; children?: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 align-middle", className)}><CountryFlag code={code} />{children ?? code}</span>
}

/** Native options cannot hold images, so the flag of the current choice sits inside the field. */
export function CountrySelect({ wrapperClassName, className, value, ...props }: React.ComponentProps<"select"> & { value: string; wrapperClassName?: string }) {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <CountryFlag code={value} className="pointer-events-none absolute inset-y-0 start-3 my-auto" />
      <NativeSelect className={cn(className, "ps-9")} value={value} {...props} />
    </span>
  )
}
