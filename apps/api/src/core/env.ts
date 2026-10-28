import { z } from "zod"

// Chapter 36.3 — environment variables only for secrets and infrastructure endpoints; business configuration lives in
// the database. Provider credentials are never environment variables (entered in the Developer Panel).
const Env = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4100),
  DATABASE_URL: z.string().default("postgres://app_rw:app_rw_dev@localhost:5462/unitravel"),
  REDIS_URL: z.string().default("redis://localhost:6390"),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEYS: z.string().optional(),
  MASTER_ENCRYPTION_KEY: z.string().optional(),
  OTP_PEPPER: z.string().optional(),
  OBJECT_STORAGE_ENDPOINT: z.string().default("http://localhost:9010"),
  OBJECT_STORAGE_PUBLIC_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().default("eu-west-2"),
  OBJECT_STORAGE_BUCKET: z.string().default("unitravel-documents"),
  OBJECT_STORAGE_ACCESS_KEY: z.string().default("unitravel"),
  OBJECT_STORAGE_SECRET_KEY: z.string().default("unitravel-secret"),
  PUBLIC_WEB_URL: z.string().default("http://localhost:4000"),
  PUBLIC_CONSOLE_ADMIN_URL: z.string().default("http://admin.localhost:4200"),
  PUBLIC_CONSOLE_DEV_URL: z.string().default("http://dev.localhost:4200"),
  PUBLIC_MOBILE_WEB_URL: z.string().default("http://localhost:4300"),
  PUBLIC_API_URL: z.string().default("http://localhost:4100"),
  SMTP_URL: z.string().default("smtp://localhost:1035"),
  MAIL_FROM: z.string().default("Uni Travel <no-reply@unitravel.example>"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),
  APP_VERSION: z.string().default("1.0.0"),
  GIT_COMMIT: z.string().default("local"),
  TRUST_PROXY: z.string().default("loopback"),
  LOG_LEVEL: z.string().default("info"),
  OUTBOX_POLL_MS: z.coerce.number().default(500),
  /**
   * ADR-0012: email-only sign-in for the testing phase. Never allowed with APP_ENV=production. "customers" (ADR-0017)
   * limits it to customer accounts: staff still need a code and their second factor.
   */
  TEST_SIGN_IN: z.enum(["off", "customers", "on"]).default("off"),
})

export type Env = z.infer<typeof Env>

const PLACEHOLDER = /CHANGE_?ME|changeme|placeholder|not-for-production|app_rw_dev|app_ro_dev|unitravel-secret/i

function urlPassword(url: string): string {
  try {
    return decodeURIComponent(new URL(url).password)
  } catch {
    return ""
  }
}

/**
 * Everything that makes a deployed host (staging or production) unsafe to start: placeholder or short secrets, the
 * local development credentials, and in production an unauthenticated Valkey. Empty for APP_ENV=local.
 */
export function deploymentProblems(e: Env, raw: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = []
  // A production image (NODE_ENV=production) that forgot APP_ENV would otherwise fall back to "local" and its dev keys.
  if (raw.NODE_ENV === "production" && !raw.APP_ENV) out.push("APP_ENV must be set explicitly when NODE_ENV=production")
  if (e.APP_ENV === "local") return out
  const secret = (name: string, value: string | undefined, min: number) => {
    if (!value) out.push(`${name} is required outside local development`)
    else if (PLACEHOLDER.test(value)) out.push(`${name} still holds a placeholder value`)
    else if (value.length < min) out.push(`${name} must be at least ${min} characters`)
  }
  secret("JWT_PRIVATE_KEY", e.JWT_PRIVATE_KEY, 40)
  secret("JWT_PUBLIC_KEYS", e.JWT_PUBLIC_KEYS, 20)
  secret("MASTER_ENCRYPTION_KEY", e.MASTER_ENCRYPTION_KEY, 32)
  secret("OTP_PEPPER", e.OTP_PEPPER, 32)
  secret("OBJECT_STORAGE_SECRET_KEY", e.OBJECT_STORAGE_SECRET_KEY, 16)
  secret("DATABASE_URL password", urlPassword(e.DATABASE_URL), 16)
  if (PLACEHOLDER.test(urlPassword(e.REDIS_URL))) out.push("REDIS_URL password still holds a placeholder value")
  if (e.APP_ENV === "production") {
    if (e.TEST_SIGN_IN !== "off") out.push(`TEST_SIGN_IN=${e.TEST_SIGN_IN} is refused in production (ADR-0012)`)
    if (!urlPassword(e.REDIS_URL)) out.push("REDIS_URL must carry a password in production (redis://:<password>@host:port)")
    if (!e.PUBLIC_WEB_URL.startsWith("https://") || !e.PUBLIC_API_URL.startsWith("https://")) out.push("Public URLs must be https in production")
  }
  return out
}

let cached: Env | undefined
export function env(): Env {
  if (!cached) {
    const parsed = Env.parse(process.env)
    const problems = deploymentProblems(parsed)
    if (problems.length) throw new Error(`Refusing to start (${parsed.APP_ENV}):\n- ${problems.join("\n- ")}`)
    cached = parsed
  }
  return cached
}

export const isLocal = () => env().APP_ENV === "local"
export const testSignInEnabled = () => env().TEST_SIGN_IN !== "off"
/** Test sign-in also covers staff accounts and skips their second factor (TEST_SIGN_IN=on only). */
export const testSignInForStaff = () => env().TEST_SIGN_IN === "on"
/**
 * ADR-0014: FAKE adapters, sandbox credentials and Stripe test mode exist only on a developer machine or CI. NODE_ENV is
 * a second net: a production image with APP_ENV unset would otherwise default to "local".
 */
export const sandboxAllowed = () => isLocal() && process.env.NODE_ENV !== "production"
