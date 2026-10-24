// Server-safe (no "use client"): layout.tsx inlines this script so theme, density and language are set before first paint.
export const PREF_KEYS = { theme: "ut-theme", density: "ut-density", rail: "ut-rail", locale: "ut-locale" } as const
const KEY = PREF_KEYS

/** Keep in sync with applyPrefs() in prefs.ts. */
export const PREFS_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage,t=s.getItem("${KEY.theme}")||"system";d.dataset.theme=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";d.dataset.rail=s.getItem("${KEY.rail}")==="collapsed"?"collapsed":"open";d.dataset.density=s.getItem("${KEY.density}")==="compact"?"compact":"comfortable";if(s.getItem("${KEY.locale}")==="fa"){d.lang="fa";d.dir="rtl"}}catch(e){}})()`

