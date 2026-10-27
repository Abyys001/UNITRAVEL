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
  /** ADR-0012: email-only sign-in for the testing phase. Never allowed with APP_ENV=production. */
  TEST_SIGN_IN: z.enum(["off", "on"]).default("off"),
})

export type Env = z.infer<typeof Env>

let cached: Env | undefined
export function env(): Env {
  if (!cached) {
    cached = Env.parse(process.env)
    if (cached.APP_ENV === "production") {
      if (cached.TEST_SIGN_IN === "on") throw new Error("TEST_SIGN_IN=on is refused in production (ADR-0012)")
      for (const k of ["JWT_PRIVATE_KEY", "JWT_PUBLIC_KEYS", "MASTER_ENCRYPTION_KEY", "OTP_PEPPER"] as const) {
        if (!cached[k]) throw new Error(`${k} is required in production`)
      }
    }
  }
  return cached
}

export const isLocal = () => env().APP_ENV === "local"
export const testSignInEnabled = () => env().TEST_SIGN_IN === "on"
/**
 * ADR-0014: FAKE adapters, sandbox credentials and Stripe test mode exist only on a developer machine or CI. NODE_ENV is
 * a second net: a production image with APP_ENV unset would otherwise default to "local".
 */
export const sandboxAllowed = () => isLocal() && process.env.NODE_ENV !== "production"
