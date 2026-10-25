/** Sample values for "send test to me": every variable a template declares gets one, so no placeholder reaches the recipient. */
const SAMPLES: Record<string, string> = {
  ref: "UT-F-TEST00", route: "Tehran → London", code: "123456", status_label: "Being reviewed", status_label_fa: "در حال بررسی",
  name: "Test Traveller", number: "QT-TEST-0001", message: "This is a test message.", message_preview: "This is a test message.",
  link: "https://example.invalid/test", client: "web", decision: "RELEASE", trigger: "SCREENING", roles: "admin", actor: "Uni Travel",
  provider: "test-provider", detail: "Test detail", route_name: "+98", rate: "0.5", ticket_numbers: "125-1234567890", amount: "100.00", currency: "GBP",
}

export function sampleVars(declared: readonly string[], now = new Date()): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  const at = new Date(now.getTime() + 24 * 3600_000).toISOString()
  for (const v of declared) {
    if (v.endsWith("_at")) out[v] = at
    // `<x>_local` and `<x>_at_local` are derived from `<x>_at` by the notification service.
    else if (v.endsWith("_at_local")) out[v.slice(0, -6)] = at
    else if (v.endsWith("_local")) out[`${v.slice(0, -6)}_at`] = at
    else out[v] = SAMPLES[v] ?? `[${v}]`
  }
  return out
}
