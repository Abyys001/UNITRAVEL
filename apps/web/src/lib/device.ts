"use client"

/** Stable per-browser id used to bind OTP challenges to this device (ch. 25.1). */
export function deviceId(): string {
  try {
    let id = localStorage.getItem("ut_device")
    if (!id) { id = `web-${crypto.randomUUID()}`; localStorage.setItem("ut_device", id) }
    return id
  } catch {
    return `web-${crypto.randomUUID()}`
  }
}
