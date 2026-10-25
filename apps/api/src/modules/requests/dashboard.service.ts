import { Inject, Injectable } from "@nestjs/common"
import { and, eq, gte, inArray, sql } from "drizzle-orm"

import type { CargoStatus, DashboardMetrics, FlightRequestStatus } from "@unitravel/contracts"
import { cargoRequests, type Db, flightRequests, invoices } from "@unitravel/db"

import { DB } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"

/** Business day for calendar buckets; the same zone invoices use for "end of day" expiry (ADR-0006). */
const TZ = "Europe/London"
/** Requests that are still being worked; closed ones are outcomes, not queue load. */
const OPEN_FLIGHT: FlightRequestStatus[] = ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "RESERVED"]
const CLOSED_CARGO: CargoStatus[] = ["DELIVERED", "COMPLETED", "DECLINED", "CANCELLED", "EXPIRED"]

/**
 * Read-only aggregates for the Admin Panel dashboard. Every figure is a count or sum over existing rows — no estimates and no
 * synthetic history. Sections the viewer may not read come back null so the console shows an honest "not available" state.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async metrics(actor: Actor, days: number): Promise<DashboardMetrics> {
    const flights = actor.permissions.has("flight_request.read.any")
    const cargo = actor.permissions.has("cargo_request.read.any")
    const money = actor.permissions.has("pricing.read.internal")
    // [from, to] as London calendar dates; the series always has `days` entries, zero-filled, oldest first.
    const [range] = (await this.db.execute(sql`select to_char((now() at time zone ${TZ})::date - (${days}::int - 1), 'YYYY-MM-DD') as "from", to_char((now() at time zone ${TZ})::date, 'YYYY-MM-DD') as "to", (((now() at time zone ${TZ})::date - (${days}::int - 1))::timestamp at time zone ${TZ}) as start`)).rows as { from: string; to: string; start: Date }[]
    const { from, to, start } = range!
    const since = new Date(start)
    const day = (col: typeof flightRequests.submittedAt | typeof cargoRequests.submittedAt) => sql<string>`to_char((${col} at time zone ${TZ})::date, 'YYYY-MM-DD')`

    const [fDays, cDays, fStatus, cStatus, contact] = await Promise.all([
      flights ? this.db.select({ d: day(flightRequests.submittedAt), n: sql<number>`count(*)::int` }).from(flightRequests).where(gte(flightRequests.submittedAt, since)).groupBy(sql`1`) : null,
      cargo ? this.db.select({ d: day(cargoRequests.submittedAt), n: sql<number>`count(*)::int` }).from(cargoRequests).where(gte(cargoRequests.submittedAt, since)).groupBy(sql`1`) : null,
      flights ? this.db.select({ status: flightRequests.status, count: sql<number>`count(*)::int` }).from(flightRequests).where(inArray(flightRequests.status, OPEN_FLIGHT)).groupBy(flightRequests.status) : null,
      cargo ? this.db.select({ status: cargoRequests.status, count: sql<number>`count(*)::int` }).from(cargoRequests).where(sql`${cargoRequests.status} not in (${sql.join(CLOSED_CARGO.map((s) => sql`${s}`), sql`, `)})`).groupBy(cargoRequests.status) : null,
      flights ? this.db.select({
        met: sql<number>`count(*) filter (where ${flightRequests.firstContactAt} is not null and (${flightRequests.slaDueAt} is null or ${flightRequests.firstContactAt} <= ${flightRequests.slaDueAt}))::int`,
        missed: sql<number>`count(*) filter (where (${flightRequests.firstContactAt} is not null and ${flightRequests.firstContactAt} > ${flightRequests.slaDueAt}) or (${flightRequests.firstContactAt} is null and ${flightRequests.slaDueAt} < now()))::int`,
        pending: sql<number>`count(*) filter (where ${flightRequests.firstContactAt} is null and (${flightRequests.slaDueAt} is null or ${flightRequests.slaDueAt} >= now()))::int`,
      }).from(flightRequests).where(and(gte(flightRequests.submittedAt, since), sql`${flightRequests.status} not in ('SUBMITTED', 'COMPLIANCE_HOLD')`)) : null,
    ])

    const series: DashboardMetrics["submissions"] = []
    const f = new Map((fDays ?? []).map((r) => [r.d, r.n]))
    const c = new Map((cDays ?? []).map((r) => [r.d, r.n]))
    for (let i = 0; i < days; i++) {
      const d = new Date(`${from}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      series.push({ date: key, flight: flights ? (f.get(key) ?? 0) : null, cargo: cargo ? (c.get(key) ?? 0) : null })
    }

    // Invoices: only product lines the viewer can read (same rule as the invoice list); everything for document issuers.
    const issuer = actor.permissions.has("commercial_document.issue")
    const types = issuer ? null : [...(flights ? ["FLIGHT"] : []), ...(cargo ? ["CARGO"] : [])]
    let inv: DashboardMetrics["invoices"] = null
    if (issuer || (types && types.length)) {
      const scope = types ? inArray(invoices.requestType, types as ("FLIGHT" | "CARGO")[]) : undefined
      const byStatus = await this.db.select({ status: invoices.status, count: sql<number>`count(*)::int` }).from(invoices).where(scope).groupBy(invoices.status)
      const sum = (where: ReturnType<typeof and>) => this.db.select({ currency: invoices.currency, amountMinor: sql<number>`coalesce(sum(${invoices.totalMinor}), 0)::bigint`, count: sql<number>`count(*)::int` }).from(invoices).where(where).groupBy(invoices.currency)
      const toNum = (rows: { currency: string; amountMinor: number | string; count: number }[]) => rows.map((r) => ({ currency: r.currency, amountMinor: Number(r.amountMinor), count: r.count }))
      inv = {
        byStatus,
        outstanding: money ? toNum(await sum(and(eq(invoices.status, "ISSUED"), scope))) : null,
        paidInRange: money ? toNum(await sum(and(eq(invoices.status, "PAID"), gte(invoices.paidAt, since), scope))) : null,
      }
    }

    return {
      range: { days, from, to, timezone: TZ },
      submissions: series,
      flightStatus: fStatus,
      cargoStatus: cStatus as DashboardMetrics["cargoStatus"],
      firstContact: contact ? contact[0] ?? { met: 0, missed: 0, pending: 0 } : null,
      invoices: inv,
    }
  }
}
