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
  "pricing.read.internal",
  "pricing.write",
  "commercial_document.issue",
  "reservation.record",
  "ticket.record",
  "payment.record",
  "payment.refund.request",
  "payment.refund.approve",
  "payments.configure",
  "payments.mode.approve",
  "cargo_request.create.own",
  "cargo_request.read.own",
  "cargo_request.read.any",
  "cargo_request.transition",
  "service_request.create.own",
  "service_request.read.own",
  "service_request.read.any",
  "service_request.write",
  "loyalty.read.own",
  "loyalty.read",
  "loyalty.manage",
  "loyalty.benefit.approve",
  "customer.read.pii",
  "customer.read.documents",
  "identity.verify",
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

/**
 * Catalogue flag: a role holding any `privileged` permission is itself privileged, so assigning it needs
 * `user.role.assign.privileged`, step-up and an owner alert (ch. 10.3). The Record is exhaustive, so a new permission cannot be added without deciding.
 */
export const PERMISSION_CATALOGUE: Record<Permission, { privileged: boolean }> = {
  "flight_search.run": { privileged: false },
  "flight_request.create.own": { privileged: false },
  "flight_request.read.own": { privileged: false },
  "flight_request.read.any": { privileged: false },
  "flight_request.assign": { privileged: false },
  "flight_request.transition": { privileged: false },
  "flight_request.note.internal": { privileged: false },
  "quote.create": { privileged: false },
  "pricing.read.internal": { privileged: false },
  "pricing.write": { privileged: true },
  "commercial_document.issue": { privileged: false },
  "reservation.record": { privileged: false },
  "ticket.record": { privileged: false },
  "payment.record": { privileged: false },
  "payment.refund.request": { privileged: false },
  "payment.refund.approve": { privileged: true },
  "payments.configure": { privileged: true },
  "payments.mode.approve": { privileged: true },
  "cargo_request.create.own": { privileged: false },
  "cargo_request.read.own": { privileged: false },
  "cargo_request.read.any": { privileged: false },
  "cargo_request.transition": { privileged: false },
  "service_request.create.own": { privileged: false },
  "service_request.read.own": { privileged: false },
  "service_request.read.any": { privileged: false },
  "service_request.write": { privileged: false },
  "loyalty.read.own": { privileged: false },
  "loyalty.read": { privileged: false },
  "loyalty.manage": { privileged: true },
  "loyalty.benefit.approve": { privileged: true },
  "customer.read.pii": { privileged: true },
  "customer.read.documents": { privileged: true },
  "identity.verify": { privileged: true },
  "compliance.case.read": { privileged: false },
  "compliance.case.decide": { privileged: true },
  "user.read": { privileged: false },
  "user.role.assign": { privileged: true },
  "user.role.assign.privileged": { privileged: true },
  "provider.config.read": { privileged: false },
  "provider.config.write": { privileged: true },
  "engine.rules.read": { privileged: false },
  "engine.rules.publish": { privileged: true },
  "settings.write": { privileged: true },
  "flags.write": { privileged: true },
  "notification.template.write": { privileged: true },
  "audit.read": { privileged: false },
  "diagnostics.read": { privileged: false },
}

export const PRIVILEGED_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((p) => PERMISSION_CATALOGUE[p].privileged)

export function hasPrivilegedPermission(permissions: readonly string[]): boolean {
  return permissions.some((p) => PRIVILEGED_PERMISSIONS.includes(p as Permission))
}

export const BUILT_IN_ROLES = ["customer", "admin", "cargo_admin", "compliance_officer", "developer", "owner"] as const
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number]

/** Granting these needs `user.role.assign.privileged`, step-up, and alerts every owner (ch. 10.3). */
export const PRIVILEGED_ROLES: readonly BuiltInRole[] = ["developer", "owner", "compliance_officer"]

/** Table 10.1 — default permission matrix. */
export const DEFAULT_ROLE_PERMISSIONS: Record<BuiltInRole, readonly Permission[]> = {
  customer: [
    "flight_search.run", "flight_request.create.own", "flight_request.read.own", "cargo_request.create.own", "cargo_request.read.own",
    "service_request.create.own", "service_request.read.own", "loyalty.read.own",
  ],
  admin: [
    "flight_search.run", "flight_request.read.any", "flight_request.assign", "flight_request.transition",
    "flight_request.note.internal", "quote.create", "pricing.read.internal", "pricing.write", "commercial_document.issue", "reservation.record", "ticket.record",
    "payment.record", "payment.refund.request", "payment.refund.approve", "customer.read.pii", "customer.read.documents", "identity.verify", "engine.rules.read",
    "service_request.read.any", "service_request.write", "loyalty.read", "loyalty.manage", "loyalty.benefit.approve",
  ],
  cargo_admin: [
    "flight_search.run", "flight_request.note.internal", "payment.record", "cargo_request.read.any",
    "cargo_request.transition", "customer.read.pii", "customer.read.documents",
  ],
  compliance_officer: [
    "flight_request.read.any", "flight_request.note.internal", "cargo_request.read.any", "customer.read.pii",
    "customer.read.documents", "compliance.case.read", "compliance.case.decide", "audit.read", "service_request.read.any",
  ],
  developer: [
    "flight_search.run", "user.read", "user.role.assign", "provider.config.read", "provider.config.write",
    "engine.rules.read", "engine.rules.publish", "settings.write", "flags.write", "notification.template.write",
    "audit.read", "diagnostics.read", "payments.configure",
  ],
  owner: [...PERMISSIONS],
}

/** Permissions that only make sense for staff; their presence turns on admin mode in the apps. */
export const STAFF_SURFACE_PERMISSIONS: readonly Permission[] = ["flight_request.read.any", "cargo_request.read.any", "service_request.read.any"]
export const DEV_SURFACE_PERMISSIONS: readonly Permission[] = ["user.read", "provider.config.read", "diagnostics.read", "settings.write"]

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value)
}
