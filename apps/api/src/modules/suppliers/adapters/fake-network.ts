// Deterministic network for the FAKE adapter (local development and tests only, ch. 21.8). Every offer it produces
// is labelled FAKE; the adapter is refused at start-up in production. Times and prices are illustrative.

export interface LegTemplate {
  carrier: string
  number: string
  from: string
  to: string
  dep: string
  durationMin: number
  /** 0 = Sunday … 6 = Saturday */
  days: number[]
  aircraft: string
  terminals?: [string, string]
}

export interface OfferTemplate {
  legs: LegTemplate[]
  /** Minimum connection minutes between legs; arrival → next departure is computed from each leg's schedule. */
  price: [number, number]
  bags: "23KG" | "20KG" | "CABIN_ONLY" | "UNKNOWN"
  brand: string | null
  conditions: "FLEX" | "LIGHT" | "UNKNOWN"
  seatMap: boolean
}

const ALL = [0, 1, 2, 3, 4, 5, 6]
const L = (carrier: string, number: string, from: string, to: string, dep: string, durationMin: number, days = ALL, aircraft = "320", terminals?: [string, string]): LegTemplate => ({ carrier, number, from, to, dep, durationMin, days, aircraft, terminals })

export const FAKE_OFFERS: OfferTemplate[] = [
  // Iranian carriers: returned by the "supplier" but always removed by the D-01 carrier policy.
  { legs: [L("IR", "721", "IKA", "IST", "07:30", 230, ALL, "320", ["1", "1"])], price: [180, 240], bags: "23KG", brand: "Economy", conditions: "UNKNOWN", seatMap: false },
  { legs: [L("W5", "112", "IKA", "IST", "09:15", 235, ALL, "333", ["1", "1"]), L("TK", "1979", "IST", "LHR", "15:45", 245, ALL, "77W", ["1", "2"])], price: [390, 460], bags: "23KG", brand: null, conditions: "UNKNOWN", seatMap: false },
  { legs: [L("W5", "4562", "IKA", "MCT", "02:40", 135, ALL, "333", ["1", "1"])], price: [150, 210], bags: "UNKNOWN", brand: null, conditions: "UNKNOWN", seatMap: false },
  { legs: [L("EP", "3205", "MHD", "NJF", "06:00", 160, [1, 4], "AT7", ["1", "1"])], price: [120, 160], bags: "UNKNOWN", brand: null, conditions: "UNKNOWN", seatMap: false },

  // Foreign carriers that resumed Iran services (reported Oct 2026): SalamAir via Muscat twice weekly, Iraqi Airways via Najaf.
  { legs: [L("OV", "511", "IKA", "MCT", "04:20", 130, [3, 6], "32N", ["1", "1"])], price: [140, 190], bags: "20KG", brand: "Friendly", conditions: "LIGHT", seatMap: true },
  { legs: [L("IA", "116", "IKA", "NJF", "10:40", 150, ALL, "738", ["1", "1"])], price: [110, 150], bags: "23KG", brand: null, conditions: "UNKNOWN", seatMap: false },
  { legs: [L("IA", "118", "MHD", "NJF", "08:10", 165, [0, 2, 4], "738", ["1", "1"])], price: [120, 165], bags: "23KG", brand: null, conditions: "UNKNOWN", seatMap: false },
  { legs: [L("IA", "122", "IFN", "NJF", "12:30", 115, [1, 5], "738", ["1", "1"])], price: [100, 140], bags: "23KG", brand: null, conditions: "UNKNOWN", seatMap: false },

  // Hub → Europe.
  { legs: [L("WY", "101", "MCT", "LHR", "09:35", 470, ALL, "789", ["1", "4"])], price: [330, 470], bags: "23KG", brand: "Economy Saver", conditions: "LIGHT", seatMap: true },
  { legs: [L("WY", "103", "MCT", "LHR", "13:10", 475, ALL, "789", ["1", "4"])], price: [360, 520], bags: "23KG", brand: "Economy Comfort", conditions: "FLEX", seatMap: true },
  { legs: [L("WY", "125", "MCT", "FRA", "10:05", 415, [2, 4, 6], "789", ["1", "1"])], price: [310, 430], bags: "23KG", brand: "Economy Saver", conditions: "LIGHT", seatMap: true },
  { legs: [L("IA", "237", "NJF", "IST", "15:20", 205, [1, 3, 5], "738", ["1", "1"])], price: [140, 200], bags: "23KG", brand: null, conditions: "UNKNOWN", seatMap: false },

  // Türkiye gateways (Van, Erzurum) → Istanbul, domestic.
  { legs: [L("TK", "2721", "VAN", "IST", "07:10", 110, ALL, "321", ["1", "1"])], price: [55, 95], bags: "UNKNOWN", brand: null, conditions: "UNKNOWN", seatMap: true },
  { legs: [L("PC", "2671", "VAN", "SAW", "10:25", 115, ALL, "32N", ["1", "1"])], price: [35, 70], bags: "CABIN_ONLY", brand: "Basic", conditions: "LIGHT", seatMap: false },
  { legs: [L("VF", "3061", "VAN", "IST", "16:40", 110, [0, 1, 3, 5], "738", ["1", "1"])], price: [40, 75], bags: "CABIN_ONLY", brand: "EcoFly", conditions: "LIGHT", seatMap: false },
  { legs: [L("TK", "2649", "ERZ", "IST", "08:30", 120, ALL, "321", ["1", "1"])], price: [50, 90], bags: "23KG", brand: null, conditions: "UNKNOWN", seatMap: true },
  { legs: [L("XQ", "1263", "ERZ", "DUS", "11:00", 285, [2, 6], "738", ["1", "1"])], price: [160, 230], bags: "20KG", brand: "SunEco", conditions: "LIGHT", seatMap: false },

  // Istanbul → UK and Europe.
  { legs: [L("BA", "675", "IST", "LHR", "13:50", 285, ALL, "320", ["1", "5"])], price: [180, 330], bags: "23KG", brand: "Euro Traveller", conditions: "LIGHT", seatMap: true },
  { legs: [L("TK", "1971", "IST", "LHR", "11:00", 245, ALL, "77W", ["1", "2"])], price: [190, 340], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },
  { legs: [L("TK", "1985", "IST", "LGW", "18:20", 250, [1, 3, 5, 0], "321", ["1", "S"])], price: [170, 290], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },
  { legs: [L("W6", "4302", "IST", "LTN", "06:15", 255, [2, 4, 6], "32Q", ["1", "1"])], price: [60, 140], bags: "CABIN_ONLY", brand: "Basic", conditions: "LIGHT", seatMap: false },
  { legs: [L("PC", "1169", "SAW", "STN", "08:05", 260, ALL, "32N", ["1", "1"])], price: [70, 160], bags: "CABIN_ONLY", brand: "Essentials", conditions: "LIGHT", seatMap: false },
  { legs: [L("PC", "1173", "SAW", "MAN", "12:40", 275, [1, 3, 5], "32N", ["1", "1"])], price: [80, 170], bags: "CABIN_ONLY", brand: "Essentials", conditions: "LIGHT", seatMap: false },
  { legs: [L("TK", "1993", "IST", "MAN", "09:30", 265, ALL, "321", ["1", "2"])], price: [190, 320], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },
  { legs: [L("TK", "1587", "IST", "FRA", "08:00", 195, ALL, "321", ["1", "1"])], price: [140, 260], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },
  { legs: [L("TK", "1995", "IST", "MAN", "12:40", 265, ALL, "321", ["1", "2"])], price: [180, 300], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },
  { legs: [L("TK", "1591", "IST", "FRA", "13:15", 195, ALL, "32Q", ["1", "1"])], price: [130, 240], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },
  { legs: [L("TK", "1951", "IST", "AMS", "10:15", 215, ALL, "321", ["1", "1"])], price: [150, 270], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },

  // Through itineraries on one ticket (supplier-validated connections).
  { legs: [L("TK", "2721", "VAN", "IST", "07:10", 110, ALL, "321", ["1", "1"]), L("TK", "1971", "IST", "LHR", "11:00", 245, ALL, "77W", ["1", "2"])], price: [300, 460], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },
  { legs: [L("TK", "2649", "ERZ", "IST", "08:30", 120, ALL, "321", ["1", "1"]), L("TK", "1985", "IST", "LGW", "18:20", 250, [1, 3, 5, 0], "321", ["1", "S"])], price: [290, 430], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },
  { legs: [L("TK", "2721", "VAN", "IST", "07:10", 110, ALL, "321", ["1", "1"]), L("TK", "1995", "IST", "MAN", "12:40", 265, ALL, "321", ["1", "2"])], price: [290, 420], bags: "23KG", brand: "EcoFly", conditions: "FLEX", seatMap: true },

  // Yerevan (Armenia gateway).
  { legs: [L("W6", "7709", "EVN", "LTN", "05:20", 330, [1, 5], "32Q", ["1", "1"])], price: [80, 190], bags: "CABIN_ONLY", brand: "Basic", conditions: "LIGHT", seatMap: false },
  { legs: [L("OS", "632", "EVN", "VIE", "04:15", 245, ALL, "E90", ["1", "3"]), L("OS", "451", "VIE", "LHR", "08:40", 150, ALL, "320", ["3", "2"])], price: [330, 480], bags: "23KG", brand: "Economy Classic", conditions: "FLEX", seatMap: true },
  { legs: [L("OS", "632", "EVN", "VIE", "04:15", 245, ALL, "E90", ["1", "3"])], price: [150, 260], bags: "23KG", brand: "Economy Light", conditions: "LIGHT", seatMap: true },
  { legs: [L("OS", "455", "VIE", "LHR", "13:05", 150, ALL, "320", ["3", "2"])], price: [90, 190], bags: "23KG", brand: "Economy Light", conditions: "LIGHT", seatMap: true },
  { legs: [L("LO", "730", "EVN", "WAW", "03:35", 260, [0, 2, 4, 6], "738", ["1", "A"]), L("LO", "281", "WAW", "LHR", "09:50", 165, ALL, "738", ["A", "2"])], price: [290, 440], bags: "23KG", brand: "Economy Standard", conditions: "FLEX", seatMap: true },
  { legs: [L("A3", "897", "EVN", "ATH", "03:00", 205, [1, 3, 5], "320", ["1", "1"])], price: [140, 230], bags: "UNKNOWN", brand: null, conditions: "UNKNOWN", seatMap: false },
  { legs: [L("BA", "631", "ATH", "LHR", "10:40", 235, ALL, "320", ["1", "5"])], price: [110, 220], bags: "23KG", brand: "Euro Traveller", conditions: "LIGHT", seatMap: true },
]

/** Deterministic 32-bit hash for stable fake prices. */
export function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}
