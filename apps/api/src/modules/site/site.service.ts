import { Injectable } from "@nestjs/common"

import { DEFAULT_SETTINGS, MENU_KEYS, type MenuKey, type SiteConfig } from "@unitravel/contracts"

import { ConfigService } from "../config/config.service"
import { PaymentsService } from "../payments/payments.service"

const TTL_MS = 60_000
/** The seeded placeholders are not real contacts (O13): never show them to customers. */
const placeholder = (value: string, fallback: string) => (!value.trim() || value.trim() === fallback ? null : value.trim())

/** Public site configuration (spec section 4.1, 4.6): which menu items are on, support contacts and whether card payment is on. */
@Injectable()
export class SiteService {
  private cached?: { at: number; key: string; value: SiteConfig }

  constructor(private readonly config: ConfigService, private readonly payments: PaymentsService) {}

  async get(): Promise<SiteConfig> {
    // Cached for 60 s, but a changed flag or setting (cheap, in memory) rebuilds at once so an owner's switch shows up without waiting.
    const s = this.config.settings()
    const key = JSON.stringify([this.config.flags(), s.company.phone, s.company.email, s.support])
    if (this.cached && this.cached.key === key && Date.now() - this.cached.at < TTL_MS) return this.cached.value
    const f = (k: Parameters<ConfigService["flag"]>[0]) => this.config.flag(k)
    const on: Record<MenuKey, boolean> = {
      flights: true, track: true, support: true,
      cargo: f("cargo.enabled"), club: f("loyalty.enabled"),
      hotels: f("hotels.enabled"), stays: f("stays.enabled"), trains: f("trains.enabled"), buses: f("buses.enabled"),
      visa: f("services.visa.enabled"), tours: f("services.tours.enabled"), cip: f("services.cip.enabled"), insurance: f("services.insurance.enabled"), card: f("services.card.enabled"),
    }
    const value: SiteConfig = {
      menu: Object.fromEntries(MENU_KEYS.map((k) => [k, on[k]])) as Record<MenuKey, boolean>,
      support: {
        phone: placeholder(s.company.phone, DEFAULT_SETTINGS.company.phone),
        email: placeholder(s.company.email, DEFAULT_SETTINGS.company.email),
        hours: s.support.hours,
      },
      // A flag alone is not enough: the provider must be usable (keys present, mode allowed on this host).
      payments: { online: f("payments.online.enabled") && !!(await this.payments.provider()).adapter },
    }
    this.cached = { at: Date.now(), key, value }
    return value
  }
}
