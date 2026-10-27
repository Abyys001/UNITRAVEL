import { eq, sql } from "drizzle-orm"

import {
  BUILT_IN_ROLES, DEFAULT_AUTH, DEFAULT_ENGINE_RULES, DEFAULT_FLAGS, DEFAULT_HUBS, DEFAULT_NOTIFICATION_MATRIX, DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_SETTINGS, DEFAULT_WORKFLOW, FEATURE_FLAGS, PRIVILEGED_ROLES, type ConfigDomain,
} from "@unitravel/contracts"

import { createDb, type Db } from "../index"
import * as s from "../schema"
import { AIRCRAFT, AIRLINES, AIRPORTS, CITIES, COUNTRIES } from "./reference-data"
import { TEMPLATES } from "./templates"
import { DEMO_TOTP_SECRET_HEX, devEncrypt } from "./dev-crypto"
import { providerSeedRows, shouldSeedDemo } from "./providers"

const FLAG_META: Record<string, { owner: string; removeBy: string | null; description: string }> = {
  "cargo.enabled": { owner: "operations", removeBy: null, description: "Cargo requests on web and app" },
  "search.gateways.enabled": { owner: "operations", removeBy: null, description: "Gateway starts for restricted origins (D-08)" },
  "seatmaps.enabled": { owner: "product", removeBy: "2027-06-30", description: "View-only seat maps where the supplier returns one (D-07, Stage 3)" },
  "payments.online.enabled": { owner: "owner", removeBy: null, description: "Online card payment, Stripe test mode only (ADR-0007, amends D-03); off by default, switched on by an owner" },
  "search.self_transfer.enabled": { owner: "operations", removeBy: null, description: "Self-transfer construction via hubs" },
  "sms.free_text.enabled": { owner: "operations", removeBy: null, description: "Free-text SMS from the console (off: templates only)" },
  "push.pushy_pilot.enabled": { owner: "developers", removeBy: "2027-03-31", description: "Pushy (non-FCM) pilot for Android users in Iran" },
  "maintenance.enabled": { owner: "developers", removeBy: null, description: "Maintenance banner for customers" },
  // ADR-0015 (spec docs/CONTENT-MENU-LIVE-DATA.md section 4.1): every new product is off until the owner switches it on.
  "hotels.enabled": { owner: "owner", removeBy: null, description: "Hotel listings and requests; stays off until a hotel provider is contracted and its adapter exists (O8, ADR-0015)" },
  "stays.enabled": { owner: "owner", removeBy: null, description: "Villa and stay listings and requests; off until a provider is contracted and its adapter exists (O8, ADR-0015)" },
  "trains.enabled": { owner: "owner", removeBy: null, description: "Train listings and requests; off until a rail provider is contracted and its adapter exists (O8, ADR-0015)" },
  "buses.enabled": { owner: "owner", removeBy: null, description: "Bus listings and requests; off until a coach provider is contracted and its adapter exists (O8, ADR-0015)" },
  "services.visa.enabled": { owner: "owner", removeBy: null, description: "Visa order requests; off until counsel confirms what may be offered (O6, ADR-0015)" },
  "services.tours.enabled": { owner: "owner", removeBy: null, description: "Tour call-back requests; a call, never a package sale, until counsel advises on package travel rules (O10, ADR-0015)" },
  "services.cip.enabled": { owner: "owner", removeBy: null, description: "Airport CIP requests at Tehran Imam Khomeini only; off until counsel clears the operator and sanctions position (O9, ADR-0015)" },
  "services.insurance.enabled": { owner: "owner", removeBy: null, description: "Travel insurance requests; off until counsel confirms insurance distribution permissions (O7, ADR-0015)" },
  "loyalty.enabled": { owner: "owner", removeBy: null, description: "Customer club: membership, benefits and credit; off until the owner launches it (ADR-0016)" },
}

export async function seedReference(db: Db) {
  const countryRegions = new Map(COUNTRIES.map((c) => [c[0], c[3]]))
  await db.insert(s.countries).values(COUNTRIES.map(([code, nameEn, nameFa, regionTags]) => ({ code, nameEn, nameFa, regionTags }))).onConflictDoNothing()
  await db.insert(s.cities).values(CITIES.map(([code, nameEn, nameFa, country]) => ({ code, nameEn, nameFa, country, regionTags: countryRegions.get(country) ?? [] }))).onConflictDoNothing()
  await db.insert(s.airports).values(AIRPORTS.map(([iata, icao, nameEn, nameFa, cityCode, country, tz, lat, lon]) => ({ iata, icao, nameEn, nameFa, cityCode, metroCode: cityCode, country, tz, lat, lon, source: "unitravel-curated" }))).onConflictDoNothing()
  await db.insert(s.airlines).values(AIRLINES.map(([iata, icao, accountingCode, name, country]) => ({ iata, icao, accountingCode, name, country, source: "unitravel-curated" }))).onConflictDoNothing()
  await db.insert(s.aircraftTypes).values(AIRCRAFT.map(([code, name]) => ({ code, name }))).onConflictDoNothing()
}

export async function seedAccess(db: Db) {
  const names: Record<string, string> = { customer: "Customer", admin: "Administrator", cargo_admin: "Cargo administrator", compliance_officer: "Compliance officer", developer: "Developer", owner: "Owner" }
  for (const key of BUILT_IN_ROLES) {
    const [role] = await db.insert(s.roles).values({ key, name: names[key]!, builtIn: true, privileged: PRIVILEGED_ROLES.includes(key) }).onConflictDoUpdate({ target: s.roles.key, set: { name: names[key]! } }).returning()
    await db.insert(s.rolePermissions).values(DEFAULT_ROLE_PERMISSIONS[key].map((permission) => ({ roleId: role!.id, permission }))).onConflictDoNothing()
  }
}

export async function seedConfig(db: Db) {
  const payloads: Record<ConfigDomain, unknown> = {
    ENGINE_RULES: DEFAULT_ENGINE_RULES, HUBS: DEFAULT_HUBS, WORKFLOW: DEFAULT_WORKFLOW, NOTIFICATION_MATRIX: DEFAULT_NOTIFICATION_MATRIX, AUTH: DEFAULT_AUTH,
  }
  for (const [domain, payload] of Object.entries(payloads) as [ConfigDomain, unknown][]) {
    await db.insert(s.configVersions).values({ domain, version: 1, status: "PUBLISHED", payload, changeNote: "Booklet v1.0 defaults", publishedAt: new Date() }).onConflictDoNothing()
  }
  for (const key of FEATURE_FLAGS) {
    const m = FLAG_META[key]!
    await db.insert(s.featureFlags).values({ key, enabled: DEFAULT_FLAGS[key], owner: m.owner, removeBy: m.removeBy, description: m.description }).onConflictDoNothing()
  }
  await db.insert(s.settings).values({ key: "app", value: DEFAULT_SETTINGS }).onConflictDoNothing()
  await db.insert(s.smsRoutes).values([
    { prefix: "+98", providers: ["kavenegar", "smsir"], enabled: true },
    { prefix: "default", providers: ["sinch", "infobip"], enabled: true },
  ]).onConflictDoNothing()

  for (const [eventType, t] of Object.entries(TEMPLATES)) {
    const rows: (typeof s.notificationTemplates.$inferInsert)[] = []
    for (const locale of ["en", "fa"] as const) {
      const base = t[locale]
      rows.push({ eventType, channel: "INBOX", locale, title: base.title, body: base.body, variables: t.vars })
      rows.push({ eventType, channel: "PUSH", locale, title: base.title, body: base.body, variables: t.vars })
      const sms = locale === "en" ? t.smsEn : t.smsFa
      if (sms) rows.push({ eventType, channel: "SMS", locale, title: "", body: sms, variables: t.vars, providerTemplateId: eventType === "auth.otp" ? (locale === "fa" ? "unitravel-otp-fa" : "unitravel-otp-en") : null })
      const email = (locale === "en" ? t.emailEn : t.emailFa) ?? base
      rows.push({ eventType, channel: "EMAIL", locale, title: email.title, body: email.body, variables: t.vars })
    }
    await db.insert(s.notificationTemplates).values(rows).onConflictDoNothing()
  }

  await db.insert(s.providers).values(providerSeedRows(process.env.APP_ENV)).onConflictDoNothing()
}

const SYSTEM_ID = "00000000-0000-7000-8000-000000000000"

export async function seedCompliance(db: Db) {
  const policy = (type: typeof s.compliancePolicies.$inferInsert.type, key: string, action: "BLOCK" | "REVIEW" | "ALLOW", reason: string) =>
    ({ type, key, action, reason, status: "ACTIVE" as const, createdBy: SYSTEM_ID, approvedBy: SYSTEM_ID, approvedAt: new Date(), seededPendingCounsel: true })
  const iranian = AIRLINES.filter((a) => a[4] === "IR").map((a) => a[0])
  await db.insert(s.compliancePolicies).values([
    policy("CARRIER", "country:IR", "BLOCK", "D-01: carriers registered in Iran are excluded (all US-designated 8 Sep 2026; Iran Air also UK/EU). Seed — compliance officer to confirm against current designations."),
    ...iranian.map((c) => policy("CARRIER", c, "BLOCK", "D-01 seed list — confirm against OFAC/UK/EU lists")),
    policy("GOODS_CATEGORY", "MEDICINES", "REVIEW", "Ch. 14.4 starting proposal"), policy("GOODS_CATEGORY", "MEDICAL_DEVICES", "REVIEW", "Ch. 14.4 starting proposal"),
    policy("GOODS_CATEGORY", "ELECTRONICS", "REVIEW", "Ch. 14.4 starting proposal"), policy("GOODS_CATEGORY", "LITHIUM_BATTERIES", "REVIEW", "Ch. 14.4 — partner DG acceptance needed"),
    policy("GOODS_CATEGORY", "AIRCRAFT_VEHICLE_INDUSTRIAL_PARTS", "REVIEW", "Ch. 14.4 starting proposal"), policy("GOODS_CATEGORY", "JEWELLERY_ART", "REVIEW", "High value"),
    ...["WEAPONS", "AMMUNITION", "EXPLOSIVES", "NARCOTICS", "COUNTERFEIT", "CASH_BEARER_INSTRUMENTS", "DANGEROUS_GOODS"].map((k) => policy("GOODS_CATEGORY", k, "BLOCK", "Ch. 14.4 — prohibited")),
    policy("GOODS_CATEGORY", "FOOD_NON_PERISHABLE", "ALLOW", "Allowed with partner rules"), policy("GOODS_CATEGORY", "COSMETICS", "ALLOW", "Allowed with partner rules"),
    ...["drone", "pistol", "rifle", "ammunition", "explosive", "cocaine", "heroin", "cash", "banknote", "gold bar", "pesticide", "aerosol", "paint thinner",
      "پهپاد", "اسلحه", "مهمات", "مواد منفجره", "مواد مخدر", "پول نقد", "شمش طلا"].map((k) => policy("KEYWORD", k, ["drone", "پهپاد", "aerosol", "paint thinner", "gold bar", "شمش طلا"].includes(k) ? "REVIEW" : "BLOCK", "Keyword seed list (EN/FA) — compliance to maintain")),
    ...["laptop", "phone", "router", "battery", "power bank", "insulin", "medicine", "sensor", "engine part", "لپ‌تاپ", "گوشی", "باتری", "دارو", "انسولین", "قطعه موتور"].map((k) => policy("KEYWORD", k, "REVIEW", "Keyword seed list (EN/FA) — compliance to maintain")),
    policy("LANE", "IR:*", "REVIEW", "Lanes touching Iran start disabled and require approval (D-05)"),
    policy("LANE", "IR:EXCESS_BAGGAGE", "BLOCK", "Unaccompanied excess baggage on Iran lanes stays disabled until counsel confirms the personal-effects exception (ch. 14.2)"),
  ])
}

/**
 * ADR-0015: SERVICE policies are keyed `<TYPE>:<context>`. Run on every seed (not only the first) so existing databases
 * receive them; rows are only added when the key is missing, and an edited or retired policy is never touched.
 */
export async function seedServicePolicies(db: Db) {
  const policy = (key: string, reason: string) =>
    ({ type: "SERVICE" as const, key, action: "REVIEW" as const, reason, status: "ACTIVE" as const, createdBy: SYSTEM_ID, approvedBy: SYSTEM_ID, approvedAt: new Date(), seededPendingCounsel: true })
  const rows = [
    policy("CIP:IKA", "O9: the IKA CIP operator and payments to it need a sanctions view from counsel; every CIP request is reviewed until then. Seed, pending counsel."),
    policy("INSURANCE:IR", "O7: insurance for customers resident in Iran needs counsel's view (sanctions, distribution permissions); reviewed until then. Seed, pending counsel."),
  ]
  const existing = await db.select({ key: s.compliancePolicies.key }).from(s.compliancePolicies).where(eq(s.compliancePolicies.type, "SERVICE"))
  const have = new Set(existing.map((r) => r.key))
  const fresh = rows.filter((r) => !have.has(r.key))
  if (fresh.length) await db.insert(s.compliancePolicies).values(fresh)
}

export async function seedCargo(db: Db) {
  const all = ["DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE", "AIR_FREIGHT"] as const
  const notice = (en: string, fa: string) => ({ en, fa })
  const lanes = await db.insert(s.cargoLanes).values([
    { originCountry: "GB", destinationCountry: "TR", services: [...all], enabled: true, requiresComplianceApproval: false, volumetricDivisor: 5000, customerNotice: notice("Typical transit 3–6 working days after handover. Customs duties may be payable by the recipient.", "زمان معمول حمل ۳ تا ۶ روز کاری پس از تحویل. ممکن است عوارض گمرکی بر عهدهٔ گیرنده باشد.") },
    { originCountry: "TR", destinationCountry: "GB", services: [...all], enabled: true, requiresComplianceApproval: false, volumetricDivisor: 5000, customerNotice: notice("UK import VAT and duty may apply.", "ممکن است مالیات و عوارض واردات بریتانیا اعمال شود.") },
    { originCountry: "GB", destinationCountry: "AE", services: ["DOCUMENTS", "PARCEL", "AIR_FREIGHT"], enabled: true, requiresComplianceApproval: false, volumetricDivisor: 6000, customerNotice: notice("UAE consignees are screened before booking.", "گیرندگان امارات پیش از رزرو بررسی می‌شوند.") },
    { originCountry: "GB", destinationCountry: "AM", services: ["DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE"], enabled: true, requiresComplianceApproval: false, volumetricDivisor: 5000, customerNotice: null },
    { originCountry: "GB", destinationCountry: "IR", services: [...all], enabled: false, requiresComplianceApproval: true, volumetricDivisor: 6000, customerNotice: notice("Not available: shipments to Iran are suspended pending legal review.", "در دسترس نیست: ارسال به ایران تا بررسی حقوقی متوقف است.") },
    { originCountry: "IR", destinationCountry: "GB", services: [...all], enabled: false, requiresComplianceApproval: true, volumetricDivisor: 6000, customerNotice: notice("Not available pending legal review.", "تا بررسی حقوقی در دسترس نیست.") },
    { originCountry: "DE", destinationCountry: "IR", services: [...all], enabled: false, requiresComplianceApproval: true, volumetricDivisor: 6000, customerNotice: notice("Not available pending legal review.", "تا بررسی حقوقی در دسترس نیست.") },
  ]).returning()
  const lane = (o: string, d: string) => lanes.find((l) => l.originCountry === o && l.destinationCountry === d)!.id
  // Demo partners are fictional and clearly labelled; real partners are added after due diligence (ch. 14.8).
  await db.insert(s.partners).values([
    { name: "Demo Courier Partner (fictional)", type: "COURIER", laneIds: [lane("GB", "TR"), lane("TR", "GB"), lane("GB", "AM")], services: ["DOCUMENTS", "PARCEL"], integrationLevel: "MANUAL", complianceStatus: "CLEARED", lastScreenedAt: new Date(), contacts: [{ name: "Bookings desk", email: "bookings@courier.example" }], slaNote: "Pickup next working day", cutOffNote: "Bookings by 15:00 London" },
    { name: "Demo Freight Forwarder (fictional)", type: "FORWARDER", laneIds: [lane("GB", "TR"), lane("GB", "AE")], services: ["AIR_FREIGHT", "PARCEL"], integrationLevel: "EMAIL", complianceStatus: "CLEARED", lastScreenedAt: new Date(), contacts: [{ name: "Air desk", email: "air@forwarder.example" }], slaNote: "Quote within 24 h", cutOffNote: "Cargo at warehouse 24 h before flight" },
    { name: "Demo Baggage Shipper (fictional)", type: "BAGGAGE_SHIPPER", laneIds: [lane("GB", "TR"), lane("GB", "AM")], services: ["EXCESS_BAGGAGE"], integrationLevel: "MANUAL", complianceStatus: "PENDING", contacts: [] },
  ])
  return lanes
}

export async function seedAvailability(db: Db, checkedBy: string) {
  const rows = [
    ["Royal Mail / Parcelforce", "GB-IR", "PARCEL", "SUSPENDED", "https://www.royalmail.com/internationalupdates", "Suspended to Iran since 1 Mar 2026 (bulletin 6 Oct 2026)"],
    ["Royal Mail / Parcelforce", "GB-IR", "DOCUMENTS", "SUSPENDED", "https://www.royalmail.com/internationalupdates", "Suspended to Iran since 1 Mar 2026"],
    ["FedEx", "GB-IR", "PARCEL", "SUSPENDED", "https://www.fedex.com/en-jp/customer-support/faq/sending/what-goods-can-i-send/countries-not-served.html", "Iran on the countries-not-served list"],
    ["DHL Express", "GB-IR", "PARCEL", "UNKNOWN", "https://www.dhl.com/", "Reported suspended from 4 Mar 2026; DHL bulletin does not mention Iran"],
    ["UPS", "GB-IR", "PARCEL", "UNKNOWN", "https://www.ups.com/", "No official page found"],
    ["Send My Bag", "GB-IR", "EXCESS_BAGGAGE", "SUSPENDED", "https://www.sendmybag.com/en-gb/baggage-shipping-destinations/", "Iran not listed as a destination"],
    ["cargo.one", "GB-IR", "AIR_FREIGHT", "SUSPENDED", "https://www.cargo.one/", "Iran lanes not offered (inferred)"],
  ] as const
  await db.insert(s.serviceAvailability).values(rows.map(([providerName, lane, service, status, sourceUrl, note]) => ({ providerName, lane, service, status, sourceUrl, note, checkedBy, lastCheckedAt: new Date("2026-10-22T09:00:00Z") })))
}

export interface DemoUser { key: string; name: string; phone: string; email?: string; roles: string[]; locale: "en" | "fa"; given: string; surname: string; nameFa?: string }
export const DEMO_USERS: DemoUser[] = [
  { key: "owner", name: "Olivia Owner", phone: "+447700900001", email: "owner@unitravel.example", roles: ["owner", "customer"], locale: "en", given: "Olivia", surname: "Owner" },
  { key: "admin", name: "Sara Karimi", phone: "+447700900002", email: "sara@unitravel.example", roles: ["admin"], locale: "en", given: "Sara", surname: "Karimi", nameFa: "سارا کریمی" },
  { key: "cargo", name: "Daniel Price", phone: "+447700900003", email: "cargo@unitravel.example", roles: ["cargo_admin"], locale: "en", given: "Daniel", surname: "Price" },
  { key: "compliance", name: "Helen Moss", phone: "+447700900004", email: "compliance@unitravel.example", roles: ["compliance_officer"], locale: "en", given: "Helen", surname: "Moss" },
  { key: "developer", name: "Dev Patel", phone: "+447700900005", email: "dev@unitravel.example", roles: ["developer"], locale: "en", given: "Dev", surname: "Patel" },
  { key: "customer_ir", name: "Reza Ahmadi", phone: "+989120000001", roles: ["customer"], locale: "fa", given: "Reza", surname: "Ahmadi", nameFa: "رضا احمدی" },
  { key: "customer_uk", name: "Neda Rahimi", phone: "+447700900010", email: "neda@student.example", roles: ["customer"], locale: "en", given: "Neda", surname: "Rahimi", nameFa: "ندا رحیمی" },
]

export async function seedDemoUsers(db: Db) {
  const local = (process.env.APP_ENV ?? "local") === "local"
  const roleRows = await db.select().from(s.roles)
  const ids: Record<string, string> = {}
  for (const u of DEMO_USERS) {
    const [user] = await db.insert(s.users).values({ displayName: u.name, preferredLocale: u.locale, calendar: u.locale === "fa" ? "JALALI" : "GREGORIAN", timezone: u.phone.startsWith("+98") ? "Asia/Tehran" : "Europe/London", onDuty: u.roles.includes("admin") || u.roles.includes("cargo_admin") }).returning()
    ids[u.key] = user!.id
    await db.insert(s.userIdentities).values({ userId: user!.id, type: "PHONE", valueNormalised: u.phone, verifiedAt: new Date(), isPrimary: true })
    if (u.email) await db.insert(s.userIdentities).values({ userId: user!.id, type: "EMAIL", valueNormalised: u.email, verifiedAt: new Date(), isPrimary: false })
    await db.insert(s.customerProfiles).values({ userId: user!.id, givenNamesLatin: u.given, surnameLatin: u.surname, nameFa: u.nameFa ?? null, termsVersion: "2026-10-22", privacyVersion: "2026-10-22" })
    for (const r of u.roles) await db.insert(s.userRoles).values({ userId: user!.id, roleId: roleRows.find((x) => x.key === r)!.id })
    // The known demo TOTP secret is local only (rule 6).
    if (local && u.roles.some((r) => r !== "customer")) await db.insert(s.mfaFactors).values({ userId: user!.id, type: "TOTP", secretCiphertext: devEncrypt(DEMO_TOTP_SECRET_HEX), confirmedAt: new Date() })
  }
  return ids
}

async function main() {
  const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel"
  const { db, pool } = createDb(url)
  const existing = await db.execute(sql`select count(*)::int as n from roles`)
  if ((existing.rows[0] as { n: number }).n > 0 && process.env.SEED_FORCE !== "1") {
    console.log("already seeded (SEED_FORCE=1 to reseed reference/config)")
  }
  await seedReference(db)
  await seedAccess(db)
  await seedConfig(db)
  const policies = await db.select().from(s.compliancePolicies).limit(1)
  if (policies.length === 0) await seedCompliance(db)
  await seedServicePolicies(db)
  const lanes = await db.select().from(s.cargoLanes).limit(1)
  if (lanes.length === 0) await seedCargo(db)
  if (shouldSeedDemo(process.env.APP_ENV, process.env.SEED_DEMO)) {
    const users = await db.select().from(s.users).limit(1)
    if (users.length === 0) {
      const ids = await seedDemoUsers(db)
      await seedAvailability(db, ids.cargo!)
      console.log("demo users:", DEMO_USERS.map((u) => `${u.key}=${u.phone}`).join(" "))
    }
  }
  await pool.end()
  console.log("seed complete")
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
