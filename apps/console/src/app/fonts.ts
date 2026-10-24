import localFont from "next/font/local"

// Self-hosted (no Google Fonts — ch. 28.4); files come from the engineering kit's font library. Montserrat + Vazirmatn are the brand faces (unitravels.co.uk).
export const montserrat = localFont({ src: [{ path: "../fonts/Montserrat-Variable-latin.woff2" }, { path: "../fonts/Montserrat-Variable-latin-ext.woff2" }], variable: "--font-montserrat", display: "swap", weight: "100 900" })
export const vazirmatn = localFont({ src: "../fonts/Vazirmatn-Variable.woff2", variable: "--font-vazirmatn", display: "swap", weight: "100 900" })
export const jetbrains = localFont({ src: "../fonts/JetBrainsMono-Variable-latin.woff2", variable: "--font-jetbrains", display: "swap", weight: "100 800" })
