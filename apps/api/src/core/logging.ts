import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import { LoggerModule } from "nestjs-pino"

import { env } from "./env"

/**
 * Shared redaction list (ch. 28.5): phone numbers, emails, names, document numbers, OTP codes, tokens and free-text
 * message bodies never reach the logs. Extend, never shorten.
 */
export const REDACT_PATHS = [
  "req.headers.authorization", "req.headers.cookie", 'req.headers["set-cookie"]', 'res.headers["set-cookie"]', 'req.headers["x-csrf-token"]',
  "*.code", "*.otp", "*.token", "*.accessToken", "*.refreshToken", "*.secret", "*.password", "*.apiKey", "*.values",
  "*.phone", "*.value", "*.destination", "*.email", "*.givenNames", "*.surname", "*.givenNamesLatin", "*.surnameLatin", "*.nameFa",
  "*.number", "*.documentNumber", "*.passport", "*.body", "*.message", "*.payerName", "*.address",
]

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/

export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const inbound = req.headers["x-request-id"]
  const id = typeof inbound === "string" && REQUEST_ID.test(inbound) ? inbound : `req_${randomUUID().replace(/-/g, "")}`
  res.setHeader("x-request-id", id)
  return id
}

export const Logging = LoggerModule.forRoot({
  pinoHttp: {
    level: env().LOG_LEVEL,
    genReqId: requestId,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    customProps: (req) => ({ userId: (req as IncomingMessage & { ctx?: { actor?: { userId: string } } }).ctx?.actor?.userId, module: "http" }),
    autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
    serializers: { req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }) },
  },
})
