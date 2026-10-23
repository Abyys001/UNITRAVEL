import localFont from "next/font/local"

// Self-hosted (no Google Fonts — ch. 28.4); files come from the engineering kit's font library.
export const fraunces = localFont({ src: "../fonts/Fraunces-Variable-latin.woff2", variable: "--font-fraunces", display: "swap", weight: "300 900" })
export const inter = localFont({ src: [{ path: "../fonts/Inter-Variable-latin.woff2" }, { path: "../fonts/Inter-Variable-latin-ext.woff2" }], variable: "--font-inter", display: "swap", weight: "100 900" })
export const vazirmatn = localFont({ src: "../fonts/Vazirmatn-Variable.woff2", variable: "--font-vazirmatn", display: "swap", weight: "100 900" })
export const jetbrains = localFont({ src: "../fonts/JetBrainsMono-Variable-latin.woff2", variable: "--font-jetbrains", display: "swap", weight: "100 800" })
