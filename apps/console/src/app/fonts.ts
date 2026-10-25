import localFont from "next/font/local"

// Self-hosted (no Google Fonts — ch. 28.4); files come from the engineering kit's font library (OFL).
// ADR-0011: Inter sets UI and data text (tabular figures, built for small sizes); Montserrat stays the brand display face
// (page titles, brand); Vazirmatn covers Persian; JetBrains Mono is for references and codes only.
// Explicit fallback stacks: next/font's metric fallback uses local("Arial"), which Linux desktops do not have.
// (next/font requires literal options, so the stack is repeated per face.)

export const inter = localFont({ src: [{ path: "../fonts/Inter-Variable-latin.woff2" }, { path: "../fonts/Inter-Variable-latin-ext.woff2" }], variable: "--font-inter", display: "swap", weight: "100 900", fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"] })
export const montserrat = localFont({ src: [{ path: "../fonts/Montserrat-Variable-latin.woff2" }, { path: "../fonts/Montserrat-Variable-latin-ext.woff2" }], variable: "--font-montserrat", display: "swap", weight: "100 900", fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"] })
// Persian is only needed in fa and for names in Arabic script, so it is not preloaded on every page.
export const vazirmatn = localFont({ src: "../fonts/Vazirmatn-Variable.woff2", variable: "--font-vazirmatn", display: "swap", weight: "100 900", preload: false, fallback: ["Tahoma", "system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"] })
export const jetbrains = localFont({ src: "../fonts/JetBrainsMono-Variable-latin.woff2", variable: "--font-jetbrains", display: "swap", weight: "100 800", preload: false, fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"] })
