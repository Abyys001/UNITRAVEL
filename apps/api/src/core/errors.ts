import { ERROR_STATUS, type ErrorCode, type ProblemFieldError } from "@unitravel/contracts"

/** Every expected failure carries a stable machine code (ch. 24.2); the filter turns it into problem+json. */
export class AppError extends Error {
  readonly status: number

  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly errors?: ProblemFieldError[],
    readonly extra?: Record<string, unknown>,
  ) {
    super(detail ?? code)
    this.status = ERROR_STATUS[code]
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`)
export const forbidden = (detail = "You do not have permission to do this") => new AppError("FORBIDDEN", detail)
export const invalidTransition = (detail: string, errors?: ProblemFieldError[]) => new AppError("INVALID_TRANSITION", detail, errors)
