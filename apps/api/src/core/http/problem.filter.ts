import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common"
import type { Request, Response } from "express"
import { ZodError } from "zod"

import { type ErrorCode, type Problem, problemType } from "@unitravel/contracts"

import { AppError } from "../errors"

const TITLES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "The request is not valid",
  UNAUTHENTICATED: "Sign in required",
  TOKEN_EXPIRED: "Session expired",
  PERMISSIONS_CHANGED: "Your permissions changed; refresh and retry",
  STEP_UP_REQUIRED: "Confirm it's you to continue",
  MFA_REQUIRED: "Second factor required",
  FORBIDDEN: "Not allowed",
  NOT_FOUND: "Not found",
  VERSION_CONFLICT: "Someone else changed this; reload",
  INVALID_TRANSITION: "This action is not allowed in the current state",
  OTP_INVALID: "Code invalid or expired",
  OTP_EXPIRED: "Code invalid or expired",
  OTP_LOCKED: "Too many attempts",
  RATE_LIMITED: "Too many requests",
  CHALLENGE_REQUIRED: "Please complete the check",
  INTERNAL: "Something went wrong",
}

const FA_TITLES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "درخواست معتبر نیست",
  UNAUTHENTICATED: "لطفاً وارد شوید",
  TOKEN_EXPIRED: "نشست شما منقضی شد",
  FORBIDDEN: "مجاز نیست",
  NOT_FOUND: "یافت نشد",
  INVALID_TRANSITION: "این اقدام در وضعیت فعلی مجاز نیست",
  OTP_INVALID: "کد نامعتبر یا منقضی است",
  OTP_EXPIRED: "کد نامعتبر یا منقضی است",
  OTP_LOCKED: "تلاش‌های بیش از حد",
  RATE_LIMITED: "درخواست‌های بیش از حد",
  INTERNAL: "خطایی رخ داد",
}

export function toProblem(error: unknown, requestId: string | undefined, locale: "en" | "fa"): Problem & Record<string, unknown> {
  const title = (code: ErrorCode) => (locale === "fa" ? FA_TITLES[code] : undefined) ?? TITLES[code] ?? code
  if (error instanceof AppError) {
    return { type: problemType(error.code), title: title(error.code), status: error.status, code: error.code, detail: error.detail, requestId, errors: error.errors, ...error.extra }
  }
  if (error instanceof ZodError) {
    return {
      type: problemType("VALIDATION_FAILED"), title: title("VALIDATION_FAILED"), status: 400, code: "VALIDATION_FAILED", requestId,
      errors: error.issues.map((i) => ({ path: i.path.map((p, idx) => (typeof p === "number" ? `[${p}]` : idx === 0 ? String(p) : `.${String(p)}`)).join(""), code: i.code.toUpperCase(), message: i.message })),
    }
  }
  if (error instanceof HttpException) {
    const status = error.getStatus()
    const code: ErrorCode = status === 404 ? "NOT_FOUND" : status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 429 ? "RATE_LIMITED" : status === 413 || status === 400 ? "VALIDATION_FAILED" : "INTERNAL"
    return { type: problemType(code), title: title(code), status, code, requestId }
  }
  // Error pages never echo stack traces (ch. 28.4); the request id ties the response to the log line.
  return { type: problemType("INTERNAL"), title: title("INTERNAL"), status: 500, code: "INTERNAL", requestId }
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger("Problem")

  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const req = ctx.getRequest<Request & { id?: string }>()
    const res = ctx.getResponse<Response>()
    const locale = req.headers["accept-language"]?.toString().startsWith("fa") ? "fa" : "en"
    const problem = toProblem(error, req.id, locale)
    if (problem.status >= 500) this.log.error({ err: error, requestId: req.id }, "unhandled error")
    if (res.headersSent) return
    if (problem.code === "RATE_LIMITED" && typeof problem.retryAfter === "number") res.setHeader("Retry-After", String(problem.retryAfter))
    res.status(problem.status).type("application/problem+json").json(problem)
  }
}
