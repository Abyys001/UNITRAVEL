import "reflect-metadata"

import { NestFactory } from "@nestjs/core"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"
import cookieParser from "cookie-parser"
import helmet from "helmet"
import { Logger } from "nestjs-pino"

import { AppModule } from "./app.module"
import { env } from "./core/env"

export async function createApi() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRole("api"), { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.set("trust proxy", env().TRUST_PROXY)
  app.disable("x-powered-by")
  app.use(cookieParser())
  // The API serves JSON only: the strictest CSP, no framing, HSTS (ch. 28.4).
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }, referrerPolicy: { policy: "strict-origin-when-cross-origin" } }))
  // Webhook signatures are computed over the exact bytes Stripe sent, so keep them for that path only (ADR-0007 P6).
  app.useBodyParser("json", { limit: "1mb", verify: (req: { url?: string; rawBody?: Buffer }, _res: unknown, buf: Buffer) => { if (req.url?.startsWith("/v1/webhooks/")) req.rawBody = buf } } as { limit: string })
  // The website and console call same-origin through their /api proxy; only the Flutter web build (bearer tokens) is cross-origin.
  app.enableCors({ origin: [env().PUBLIC_MOBILE_WEB_URL], credentials: false, allowedHeaders: ["authorization", "content-type", "idempotency-key", "if-match", "accept-language", "x-device-id", "x-client-platform", "x-app-version", "last-event-id"], exposedHeaders: ["etag", "x-request-id", "retry-after", "location"] })
  app.enableShutdownHooks()
  return app
}

export function openApiDocument(app: NestExpressApplication) {
  const config = new DocumentBuilder().setTitle("Uni Travel API").setVersion("1.0.0").setDescription("Flight & cargo request platform — REST /v1 (booklet ch. 24)").addBearerAuth().build()
  return SwaggerModule.createDocument(app, config)
}
