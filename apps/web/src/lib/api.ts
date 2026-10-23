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

/** Same-origin client: CSRF double-submit header, Accept-Language, one silent refresh on expired or stale tokens (ch. 10.5). */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; locale?: string } = {}, retried = false): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST")
  const headers: Record<string, string> = { accept: "application/json", "accept-language": init.locale ?? document.documentElement.lang ?? "en", ...init.headers }
  if (init.body !== undefined) headers["content-type"] = "application/json"
  const csrf = cookie("ut_csrf")
  if (csrf && method !== "GET") headers["x-csrf-token"] = csrf
  const res = await fetch(`/api${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), credentials: "same-origin" })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const p = (data ?? { status: res.status, code: "INTERNAL", title: "Error" }) as Problem
    if (!retried && res.status === 401 && (p.code === "TOKEN_EXPIRED" || p.code === "PERMISSIONS_CHANGED") && (await refresh())) return api<T>(path, init, true)
    throw new ApiError(p)
  }
  return data as T
}

export const newIdempotencyKey = () => crypto.randomUUID()
