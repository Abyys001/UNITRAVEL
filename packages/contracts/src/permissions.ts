// Chapter 10.3 — the permission catalogue. The backend checks permissions, never role names. The Developer Panel
// can combine these into new roles but cannot invent a permission the code does not check.
export const PERMISSIONS = [
  "flight_search.run",
  "flight_request.create.own",
  "flight_request.read.own",
  "flight_request.read.any",
  "flight_request.assign",
  "flight_request.transition",
  "flight_request.note.internal",
  "quote.create",
  "reservation.record",
  "ticket.record",
  "payment.record",
  "cargo_request.create.own",
  "cargo_request.read.own",
  "cargo_request.read.any",
  "cargo_request.transition",
  "customer.read.pii",
  "customer.read.documents",
  "compliance.case.read",
  "compliance.case.decide",
  "user.read",
  "user.role.assign",
  "user.role.assign.privileged",
  "provider.config.read",
  "provider.config.write",
  "engine.rules.read",
  "engine.rules.publish",
  "settings.write",
  "flags.write",
  "notification.template.write",
  "audit.read",
  "diagnostics.read",
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const BUILT_IN_ROLES = ["customer", "admin", "cargo_admin", "compliance_officer", "developer", "owner"] as const
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number]

/** Granting these needs `user.role.assign.privileged`, step-up, and alerts every owner (ch. 10.3). */
export const PRIVILEGED_ROLES: readonly BuiltInRole[] = ["developer", "owner", "compliance_officer"]

/** Table 10.1 — default permission matrix. */
export const DEFAULT_ROLE_PERMISSIONS: Record<BuiltInRole, readonly Permission[]> = {
  customer: ["flight_search.run", "flight_request.create.own", "flight_request.read.own", "cargo_request.create.own", "cargo_request.read.own"],
  admin: [
    "flight_search.run", "flight_request.read.any", "flight_request.assign", "flight_request.transition",
    "flight_request.note.internal", "quote.create", "reservation.record", "ticket.record", "payment.record",
    "customer.read.pii", "customer.read.documents", "engine.rules.read",
  ],
  cargo_admin: [
    "flight_search.run", "flight_request.note.internal", "payment.record", "cargo_request.read.any",
    "cargo_request.transition", "customer.read.pii", "customer.read.documents",
  ],
  compliance_officer: [
    "flight_request.read.any", "flight_request.note.internal", "cargo_request.read.any", "customer.read.pii",
    "customer.read.documents", "compliance.case.read", "compliance.case.decide", "audit.read",
  ],
  developer: [
    "flight_search.run", "user.read", "user.role.assign", "provider.config.read", "provider.config.write",
    "engine.rules.read", "engine.rules.publish", "settings.write", "flags.write", "notification.template.write",
    "audit.read", "diagnostics.read",
  ],
  owner: [...PERMISSIONS],
}

/** Permissions that only make sense for staff; their presence turns on admin mode in the apps. */
export const STAFF_SURFACE_PERMISSIONS: readonly Permission[] = ["flight_request.read.any", "cargo_request.read.any"]
export const DEV_SURFACE_PERMISSIONS: readonly Permission[] = ["user.read", "provider.config.read", "diagnostics.read", "settings.write"]

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value)
}
