"use client"

/** Stable per-browser id used to bind OTP challenges to this device (ch. 25.1). */
export function deviceId(): string {
  try {
    let id = localStorage.getItem("ut_console_device")
    if (!id) { id = `console-${crypto.randomUUID()}`; localStorage.setItem("ut_console_device", id) }
    return id
  } catch {
    return `console-${crypto.randomUUID()}`
  }
}
