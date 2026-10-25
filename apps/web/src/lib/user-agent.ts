/** Browser and OS from a User-Agent string, for the signed-in devices list. Null when the client is not a recognisable browser. */
export function describeUserAgent(ua: string | null): { browser: string; os: string | null } | null {
  if (!ua) return null
  // Order matters: Edge and Opera also say Chrome, Chrome also says Safari, Android also says Linux.
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null
  if (!browser) return null
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux|X11/.test(ua) ? "Linux" : null
  return { browser, os }
}
