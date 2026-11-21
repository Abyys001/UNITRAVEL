import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, isNull } from "drizzle-orm"

import type { CreateCargoRequestBody, CreateFlightRequestBody, StaffCreateCargoBody, StaffCreateFlightRequestBody, TravellerInput } from "@unitravel/contracts"
import { cargoRequests, customerProfiles, type Db, roles, userIdentities, userRoles, users } from "@unitravel/db"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { normaliseIdentity } from "../identity/otp.service"
import { CustomersService } from "../customers/customers.service"
import { RequestsService } from "../requests/requests.service"
import { CargoService } from "./cargo.service"

export interface CustomerMatch { userId: string; displayName: string; email: string | null; phone: string | null; phoneVerified: boolean; cargoRequests: number; lastRef: string | null }

/**
 * ADR-0042 D13 / ADR-0044: staff create cargo and flight requests for customers (phone, walk-in, email). Lookup is exact
 * (an email, a phone or a UT reference), never a browse, so the create permissions do not become a customer directory.
 */
@Injectable()
export class StaffIntakeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly cargo: CargoService,
    private readonly requests: RequestsService,
    private readonly customers: CustomersService,
  ) {}

  private async match(userId: string): Promise<CustomerMatch | null> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId))
    if (!u || u.status !== "ACTIVE") return null
    const acc = await this.access.load(userId)
    // Same rule as staff-assigned services (ADR-0020): a staff account is never the customer of a staff-made request.
    if (!acc.permissions.includes("cargo_request.create.own") || this.access.isStaff(acc.permissions)) return null
    const ids = await this.db.select().from(userIdentities).where(and(eq(userIdentities.userId, userId), isNull(userIdentities.revokedAt)))
    const phone = ids.find((i) => i.type === "PHONE" && i.verifiedAt) ?? ids.find((i) => i.type === "PHONE")
    const email = ids.find((i) => i.type === "EMAIL" && i.verifiedAt) ?? ids.find((i) => i.type === "EMAIL")
    const reqs = await this.db.select({ ref: cargoRequests.ref }).from(cargoRequests).where(eq(cargoRequests.customerUserId, userId)).orderBy(desc(cargoRequests.submittedAt))
    return { userId, displayName: u.displayName, email: email?.valueNormalised ?? null, phone: phone?.valueNormalised ?? null, phoneVerified: !!phone?.verifiedAt, cargoRequests: reqs.length, lastRef: reqs[0]?.ref ?? null }
  }

  async lookup(q: string, actor: Actor): Promise<CustomerMatch[]> {
    const raw = q.trim()
    let userId: string | undefined
    if (/^UT-C-/i.test(raw)) {
      const r = await this.cargo.byRef(raw).catch(() => null)
      userId = r?.customerUserId
    } else if (/^UT-F-/i.test(raw)) {
      const r = await this.requests.byRef(raw).catch(() => null)
      userId = r?.customerUserId
    } else {
      let id: { type: "EMAIL" | "PHONE"; value: string } | null = null
      try { id = normaliseIdentity(raw.includes("@") ? "EMAIL" : "PHONE", raw) } catch { id = null }
      if (id) {
        const [hit] = await this.db.select({ userId: userIdentities.userId }).from(userIdentities).where(and(eq(userIdentities.type, id.type), eq(userIdentities.valueNormalised, id.value), isNull(userIdentities.revokedAt)))
        userId = hit?.userId
      }
    }
    const m = userId ? await this.match(userId) : null
    // Each lookup is audited: it reveals that a person is a customer.
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo.customer_lookup", entityType: "user", entityId: m?.userId, after: { found: !!m } }))
    return m ? [m] : []
  }

  /** An existing customer (never a staff account) or a new customer account with this email (unverified; customer role only). */
  async resolveCustomer(customer: { userId: string } | { name: string; email: string }, channel: string, actor: Actor, locale: "en" | "fa"): Promise<string> {
    let customerUserId: string
    if ("userId" in customer) {
      const m = await this.match(customer.userId)
      if (!m) throw notFound("Customer")
      customerUserId = m.userId
    } else {
      const email = normaliseIdentity("EMAIL", customer.email).value
      customerUserId = await this.uow.run(async (tx) => {
        const [existing] = await tx.select().from(userIdentities).where(and(eq(userIdentities.type, "EMAIL"), eq(userIdentities.valueNormalised, email), isNull(userIdentities.revokedAt)))
        if (existing) return existing.userId
        const [given, ...rest] = customer.name.split(/\s+/)
        const [u] = await tx.insert(users).values({ displayName: customer.name, preferredLocale: locale, calendar: locale === "fa" ? "JALALI" : "GREGORIAN", timezone: "Europe/London" }).returning()
        // Unverified until the customer signs in with a code sent to this address (ch. 11.2).
        await tx.insert(userIdentities).values({ userId: u!.id, type: "EMAIL", valueNormalised: email, isPrimary: true })
        await tx.insert(customerProfiles).values({ userId: u!.id, givenNamesLatin: /^[A-Za-z' .-]+$/.test(given ?? "") ? given! : null, surnameLatin: rest.length && /^[A-Za-z' .-]+$/.test(rest.join(" ")) ? rest.join(" ") : null })
        const [role] = await tx.select().from(roles).where(eq(roles.key, "customer"))
        await tx.insert(userRoles).values({ userId: u!.id, roleId: role!.id })
        await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "customer.created_by_staff", entityType: "user", entityId: u!.id, after: { email, channel } })
        return u!.id
      })
      if ((await this.match(customerUserId)) === null) throw new AppError("VALIDATION_FAILED", "This email belongs to an account that cannot send cargo", [{ path: "customer.email", code: "NOT_A_CUSTOMER" }])
    }
    return customerUserId
  }

  async create(body: StaffCreateCargoBody, actor: Actor, ctx: { requestId: string; locale: "en" | "fa" }) {
    const { customer, customerConfirmed: _c, channel, staffNote, ...fields } = body
    const customerUserId = await this.resolveCustomer(customer, channel, actor, ctx.locale)
    const ids = await this.db.select().from(userIdentities).where(and(eq(userIdentities.userId, customerUserId), isNull(userIdentities.revokedAt)))
    const identity = ids.find((i) => i.type === "PHONE" && i.verifiedAt) ?? ids.find((i) => i.type === "PHONE") ?? ids.find((i) => i.type === "EMAIL")
    if (!identity) throw new AppError("VALIDATION_FAILED", "The customer has no contact on the account")
    const asCustomer = { ...fields, shipperIdentityId: identity.id, consents: { accuracy: true, prohibitedItems: true, privacy: true }, documentIds: fields.documentIds ?? [] } as CreateCargoRequestBody
    return this.cargo.create(asCustomer, actor, ctx, { customerUserId, identityId: identity.id, channel, note: staffNote })
  }

  /** ADR-0044: a manual flight request for the customer; travellers are picked or created on the customer's account. */
  async createFlight(body: StaffCreateFlightRequestBody, actor: Actor, ctx: { requestId: string; locale: "en" | "fa" }) {
    const customerUserId = await this.resolveCustomer(body.customer, body.channel, actor, ctx.locale)
    const contactId = await this.uow.run(async (tx) => {
      const phones = await tx.select().from(userIdentities).where(and(eq(userIdentities.userId, customerUserId), eq(userIdentities.type, "PHONE"), isNull(userIdentities.revokedAt)))
      const wanted = body.contactPhone ? normaliseIdentity("PHONE", body.contactPhone).value : null
      const same = wanted ? phones.find((p) => p.valueNormalised === wanted) : phones.find((p) => p.isPrimary && p.verifiedAt) ?? phones.find((p) => p.verifiedAt) ?? phones[0]
      if (same) return same.id
      if (!wanted) throw new AppError("VALIDATION_FAILED", "The customer has no phone number on file; enter one", [{ path: "contactPhone", code: "REQUIRED" }])
      const [taken] = await tx.select().from(userIdentities).where(and(eq(userIdentities.type, "PHONE"), eq(userIdentities.valueNormalised, wanted), isNull(userIdentities.revokedAt)))
      if (taken) throw new AppError("VALIDATION_FAILED", "This phone number belongs to another account; look that customer up instead", [{ path: "contactPhone", code: "TAKEN" }])
      // Unverified until the customer signs in with it (ADR-0044: nothing has to be verified for staff to submit).
      const [id] = await tx.insert(userIdentities).values({ userId: customerUserId, type: "PHONE", valueNormalised: wanted, isPrimary: phones.length === 0 }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "customer.phone_added_by_staff", entityType: "user", entityId: customerUserId, after: { phone: `${wanted.slice(0, 5)}…${wanted.slice(-2)}` } })
      return id!.id
    })
    const travellers: { travellerId: string; passengerType: string }[] = []
    for (const t of body.travellers) {
      if ("travellerId" in t) { await this.customers.owned(customerUserId, t.travellerId); travellers.push({ travellerId: t.travellerId, passengerType: t.passengerType }) }
      else {
        const created = await this.customers.create(customerUserId, t.traveller as TravellerInput, { requestId: ctx.requestId, staffUserId: actor.userId })
        travellers.push({ travellerId: created.id, passengerType: t.passengerType })
      }
    }
    const asCustomer = {
      kind: "MANUAL", query: body.query, manual: body.manual, travellers, contactIdentityId: contactId, seatPreference: body.seatPreference, ssrs: [], bestTimeToCall: body.bestTimeToCall, note: body.note,
      acknowledgements: { notABooking: true, privacy: true },
    } as unknown as CreateFlightRequestBody
    return this.requests.create(asCustomer, actor, { requestId: ctx.requestId, locale: ctx.locale, via: "CONSOLE" }, { customerUserId, channel: body.channel, note: body.staffNote })
  }
}
