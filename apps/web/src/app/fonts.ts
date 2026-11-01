import localFont from "next/font/local"

// Self-hosted (no Google Fonts — ch. 28.4); files come from the engineering kit's font library. ADR-0023: Montserrat stays the Latin display face and logo; Figtree sets Latin text. Vazirmatn sets Persian text; Alexandria sets Persian display type.
export const montserrat = localFont({ src: [{ path: "../fonts/Montserrat-Variable-latin.woff2" }, { path: "../fonts/Montserrat-Variable-latin-ext.woff2" }], variable: "--font-montserrat", display: "swap", weight: "100 900" })
export const figtree = localFont({ src: "../fonts/Figtree-Variable.woff2", variable: "--font-figtree", display: "swap", weight: "300 900" })
export const vazirmatn = localFont({ src: "../fonts/Vazirmatn-Variable.woff2", variable: "--font-vazirmatn", display: "swap", weight: "100 900" })
// Only fa headings use it, so en pages never download it.
export const alexandria = localFont({ src: "../fonts/Alexandria-Variable-arabic.woff2", variable: "--font-alexandria", display: "swap", weight: "100 900", preload: false })
// Codes and references only, so it loads on demand.
export const jetbrains = localFont({ src: "../fonts/JetBrainsMono-Variable-latin.woff2", variable: "--font-jetbrains", display: "swap", weight: "100 800", preload: false })
