"use client"

export interface PowChallenge { algorithm: string; challenge: string; salt: string; maxnumber: number; signature: string }

/** Solves the self-hosted proof-of-work challenge in the browser (no Google/hCaptcha — ch. 8.6). */
export async function solvePow(c: PowChallenge, onProgress?: (n: number) => void): Promise<string> {
  const enc = new TextEncoder()
  for (let n = 0; n <= c.maxnumber; n++) {
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(c.salt + n))
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
    if (hex === c.challenge) return btoa(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature }))
    if (n % 2000 === 0) onProgress?.(n / c.maxnumber)
  }
  throw new Error("Challenge could not be solved")
}
