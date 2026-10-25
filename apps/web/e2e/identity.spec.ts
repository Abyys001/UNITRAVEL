import { expect, test } from "@playwright/test"

import { signIn } from "./helpers"

// Uploads PUT straight to object storage, so both the page CSP (connect-src) and the bucket CORS rules must allow it;
// the identity bucket also requires the SSE header (ADR-0005). One sign-in keeps clear of the OTP resend cooldown.
test("pre-signed uploads PUT to storage from the browser, identity scans encrypted", async ({ page }) => {
  await signIn(page, "identity-e2e@student.example")
  for (const [type, sse] of [["PASSPORT_SCAN", "AES256"], ["OTHER", null]] as const) {
    const result = await page.evaluate(async (type) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("ut_csrf="))?.slice(8) ?? ""
      // 1x1 transparent PNG
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0))
      const s = await fetch("/api/v1/uploads", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ filename: "scan.png", mime: "image/png", size: png.byteLength, type }) })
      if (!s.ok) return { step: "session", status: s.status, body: await s.text() }
      const { uploadUrl, headers } = (await s.json()) as { uploadUrl: string; headers: Record<string, string> }
      try {
        const put = await fetch(uploadUrl, { method: "PUT", headers, body: png })
        return { step: "put", status: put.status, sse: headers["x-amz-server-side-encryption"] ?? null }
      } catch (e) {
        return { step: "put", status: 0, error: String(e) }
      }
    }, type)
    expect(result, type).toMatchObject({ step: "put", status: 200, sse })
  }
})
