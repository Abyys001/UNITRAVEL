// Chapter 24.2 — stable machine codes mapped to RFC 9457 problem responses.
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  PERMISSIONS_CHANGED: 401,
  STEP_UP_REQUIRED: 401,
  MFA_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  IDEMPOTENCY_MISMATCH: 422,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_LOCKED: 429,
  CHALLENGE_REQUIRED: 428,
  RATE_LIMITED: 429,
  DESTINATION_NOT_ALLOWED: 400,
  PHONE_NOT_VERIFIED: 403,
  IDENTITY_NOT_VERIFIED: 409,
  OFFER_EXPIRED: 409,
  SUPPLIER_UNAVAILABLE: 503,
  LAST_OWNER: 409,
  SELF_TRAVELLER_EXISTS: 409,
  FEATURE_DISABLED: 403,
  LANE_DISABLED: 400,
  ATOL_PAYMENT_NOT_ALLOWED: 409,
  FOUR_EYES_REQUIRED: 409,
  SIGNATURE_INVALID: 400,
  LIVE_MODE_BLOCKED: 403,
  ONLINE_PAYMENT_NOT_OFFERED: 403,
  COMPLIANCE_REVIEW_REQUIRED: 409,
  SEARCH_EXPIRED: 410,
  INTERNAL: 500,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export interface ProblemFieldError {
  path: string
  code: string
  message?: string
}

export interface Problem {
  type: string
  title: string
  status: number
  code: ErrorCode
  detail?: string
  requestId?: string
  errors?: ProblemFieldError[]
}

export const PROBLEM_BASE = "https://api.unitravel.example/problems/"

export function problemType(code: ErrorCode): string {
  return PROBLEM_BASE + code.toLowerCase().replace(/_/g, "-")
}
