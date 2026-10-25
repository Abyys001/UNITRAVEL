"use client"

export interface Problem { status: number; code: string; title: string; detail?: string; errors?: { path: string; code: string; message?: string }[]; [k: string]: unknown }

export class ApiError extends Error {
  constructor(readonly problem: Problem) { super(problem.detail ?? problem.title) }
  get code() { return this.problem.code }
  field(path: string) { return this.problem.errors?.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message }
}

function cookie(name: string) {
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1)
}

let refreshing: Promise<boolean> | null = null
async function refresh(): Promise<boolean> {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.ok).finally(() => setTimeout(() => (refreshing = null), 0))
  return refreshing
}

/**
 * Asks the signed-in staff member for a fresh second factor; resolves true once verified. Installed by the
 * StepUpProvider so any call answered with STEP_UP_REQUIRED / MFA_REQUIRED is retried once after the prompt.
 */
type StepUpHandler = (reason: string) => Promise<boolean>
let stepUp: StepUpHandler | null = null
export function setStepUpHandler(h: StepUpHandler | null) { stepUp = h }

export type ApiInit = { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean }

/** Same-origin client: CSRF double-submit header, one silent refresh on expired or stale tokens, step-up retry (ch. 16.1). */
export async function api<T = unknown>(path: string, init: ApiInit = {}, retried = { refresh: false, stepUp: false }): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST")
  const headers: Record<string, string> = { accept: "application/json", "accept-language": "en", ...init.headers }
  if (init.body !== undefined) headers["content-type"] = "application/json"
  const csrf = cookie("ut_csrf")
  if (csrf && method !== "GET") headers["x-csrf-token"] = csrf
  const res = await fetch(`/api${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), credentials: "same-origin" })
  if (res.status === 204) return undefined as T
  if (res.ok && init.raw) return (await res.blob()) as T
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = { status: res.status, code: "INTERNAL", title: text.slice(0, 200) } }
  if (!res.ok) {
    const p = (data ?? { status: res.status, code: "INTERNAL", title: "Error" }) as Problem
    if (!retried.refresh && res.status === 401 && (p.code === "TOKEN_EXPIRED" || p.code === "PERMISSIONS_CHANGED") && (await refresh())) return api<T>(path, init, { ...retried, refresh: true })
    if (!retried.stepUp && (p.code === "STEP_UP_REQUIRED" || p.code === "MFA_REQUIRED") && stepUp && (await stepUp(p.detail ?? p.title))) return api<T>(path, init, { ...retried, stepUp: true })
    throw new ApiError(p)
  }
  return data as T
}

export const newIdempotencyKey = () => crypto.randomUUID()

export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const f = e.problem.errors?.map((x) => `${x.path}: ${x.message ?? x.code}`).join("; ")
    return [e.problem.detail ?? e.problem.title, f].filter(Boolean).join(" — ")
  }
  return e instanceof Error ? e.message : String(e)
}

/** The API refused this staff member (missing permission); retrying cannot help, so the UI says so instead of echoing "Requires <perm>". */
export const isDenied = (e: unknown) => e instanceof ApiError && e.problem.status === 403 && e.code === "FORBIDDEN"
