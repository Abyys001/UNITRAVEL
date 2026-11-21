import { z } from "zod"

import { CargoParty, CargoPieceInput, CargoPurpose, CargoService, GoodsCategory, HandoverMode, Incoterm, IsoDate, Uuid, type CreateCargoRequestBody } from "@unitravel/contracts"

/** `GET /v1/cargo/lanes` as the customer sees it: disabled lanes are listed with their notice; blocked services are already removed. */
export interface Lane { id: string; originCountry: string; destinationCountry: string; label: string; enabled: boolean; services: string[]; volumetricDivisor: number; notice: string | null }

export const SERVICES = CargoService.options
// The 13 categories a customer may declare; the enum's prohibited ones (weapons, dangerous goods…) are never offered.
export const CATEGORIES = ["DOCUMENTS", "CLOTHING", "PERSONAL_EFFECTS", "BOOKS", "FOOD_NON_PERISHABLE", "COSMETICS", "MEDICINES", "MEDICAL_DEVICES", "ELECTRONICS", "LITHIUM_BATTERIES", "AIRCRAFT_VEHICLE_INDUSTRIAL_PARTS", "JEWELLERY_ART", "OTHER"] as const satisfies readonly z.infer<typeof GoodsCategory>[]
export const PURPOSES = CargoPurpose.options
export const INCOTERMS = Incoterm.options
export const HANDOVER = HandoverMode.options
export const DECLARATIONS = ["batteries", "liquids", "medicines", "magnets", "dangerousGoods", "insuranceRequested"] as const
export const CONSENTS = ["accuracy", "prohibitedItems", "privacy"] as const

export interface Party { name: string; company: string; address: { line1: string; city: string; postcode: string; country: string }; phone: string; email: string }
export interface Piece { lengthCm: number; widthCm: number; heightCm: number; weightKg: number }
/** `value` is the unit value in pounds as typed; the body carries it in pence. */
export interface Item { description: string; category: string; quantity: number; value: number; originCountry: string; hsCode: string; purpose: string }

/** Mirrors the request body's paths (shipper.address.line1, items.0.hsCode) so client and server errors land on the same field. */
export interface CargoValues {
  laneId: string
  service: string
  pieces: Piece[]
  items: Item[]
  readyDate: string
  handoverMode: string
  incoterm: string
  declarations: Record<(typeof DECLARATIONS)[number], boolean>
  shipper: Party
  consignee: Party
  docs: { documentId: string; filename: string }[]
  consents: Record<(typeof CONSENTS)[number], boolean>
}

export const emptyParty = (country: string): Party => ({ name: "", company: "", address: { line1: "", city: "", postcode: "", country }, phone: "", email: "" })
export const newPiece = (): Piece => ({ lengthCm: 30, widthCm: 20, heightCm: 20, weightKg: 3 })
export const newItem = (originCountry: string): Item => ({ description: "", category: "OTHER", quantity: 1, value: 10, originCountry, hsCode: "", purpose: "GIFT" })

export const initialValues = (): CargoValues => ({
  laneId: "", service: "",
  pieces: [{ lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 5 }],
  items: [{ description: "", category: "CLOTHING", quantity: 1, value: 50, originCountry: "GB", hsCode: "", purpose: "PERSONAL_EFFECTS" }],
  readyDate: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
  handoverMode: "PICKUP", incoterm: "DAP",
  declarations: { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false },
  shipper: emptyParty("GB"), consignee: emptyParty("TR"),
  docs: [],
  consents: { accuracy: false, prohibitedItems: false, privacy: false },
})

const round2 = (n: number) => Math.round(n * 100) / 100
/** Ch. 14.3, shown live and labelled an estimate: volumetric = L × W × H ÷ divisor; chargeable = the greater. */
export function weights(pieces: Piece[], divisor: number) {
  const actual = pieces.reduce((s, p) => s + (p.weightKg || 0), 0)
  const vol = pieces.reduce((s, p) => s + ((p.lengthCm || 0) * (p.widthCm || 0) * (p.heightCm || 0)) / divisor, 0)
  return { actual: round2(actual), vol: round2(vol), charge: round2(Math.max(actual, vol)) }
}

export const declaredTotalMinor = (items: Item[]) => items.reduce((s, i) => s + Math.round((i.value || 0) * 100) * (i.quantity || 0), 0)

// Step slices of CreateCargoRequestBody over the wizard's values. Built from the contract's own field schemas; the
// air-freight refinements are repeated per step because the body's superRefine needs the whole body. The server stays the authority.
const optionalText = (max: number) => z.string().max(max)
const PartyInput = z.object({
  name: CargoParty.shape.name,
  company: optionalText(160),
  address: z.object({ line1: z.string().trim().min(2).max(200), city: z.string().trim().min(1).max(80), postcode: optionalText(20), country: z.string().regex(/^[A-Z]{2}$/) }),
  // Empty falls back to the verified phone on the account, as before.
  phone: z.union([z.literal(""), z.string().trim().min(6).max(32)]),
  email: z.union([z.literal(""), z.email()]),
})
const ItemInput = z.object({
  description: z.string().trim().min(2).max(300),
  category: GoodsCategory,
  quantity: z.number().int().min(1).max(10000),
  value: z.number().min(0),
  originCountry: z.string().regex(/^[A-Z]{2}$/),
  hsCode: z.union([z.literal(""), z.string().regex(/^\d{4,10}$/)]),
  purpose: CargoPurpose,
})

export const routeSchema = (lanes: Lane[]) => z.object({ laneId: Uuid }).refine((v) => lanes.some((l) => l.id === v.laneId && l.enabled), { path: ["laneId"] })

export const serviceSchema = (lanes: Lane[]) => z.object({ laneId: z.string(), service: CargoService })
  .refine((v) => lanes.find((l) => l.id === v.laneId)?.services.includes(v.service) ?? false, { path: ["service"] })

export const shipmentSchema = z
  .object({ service: z.string(), pieces: z.array(CargoPieceInput).min(1).max(50), items: z.array(ItemInput).min(1).max(100), readyDate: IsoDate, handoverMode: HandoverMode, incoterm: z.string() })
  .superRefine((v, ctx) => {
    if (v.service !== "AIR_FREIGHT") return
    if (!Incoterm.safeParse(v.incoterm).success) ctx.addIssue({ code: "custom", path: ["incoterm"], message: "Required for air freight" })
    v.items.forEach((it, i) => { if (!it.hsCode) ctx.addIssue({ code: "custom", path: ["items", i, "hsCode"], message: "Required for air freight" }) })
  })

export const contactSchema = z
  .object({ service: z.string(), shipper: PartyInput, consignee: PartyInput })
  .superRefine((v, ctx) => {
    if (v.service !== "AIR_FREIGHT") return
    for (const p of ["shipper", "consignee"] as const) if (!v[p].company.trim()) ctx.addIssue({ code: "custom", path: [p, "company"], message: "Required for air freight" })
  })

const party = (p: Party, fallbackPhone: string): CreateCargoRequestBody["shipper"] => ({
  name: p.name.trim(), company: p.company.trim() || undefined,
  address: { line1: p.address.line1, city: p.address.city, postcode: p.address.postcode || undefined, country: p.address.country },
  phone: p.phone.trim() || fallbackPhone, email: p.email.trim() || undefined,
})

/** The unchanged `POST /v1/cargo-requests` body. */
export function toBody(v: CargoValues, phone: { id: string; value: string } | undefined) {
  return {
    service: v.service, laneId: v.laneId, shipperIdentityId: phone?.id,
    shipper: party(v.shipper, phone?.value ?? ""), consignee: party(v.consignee, phone?.value ?? ""),
    readyDate: v.readyDate, handoverMode: v.handoverMode, pieces: v.pieces,
    items: v.items.map((i) => ({ description: i.description, category: i.category, quantity: i.quantity, unitValue: { amountMinor: Math.round(i.value * 100), currency: "GBP" }, originCountry: i.originCountry, hsCode: i.hsCode || undefined, purpose: i.purpose })),
    commercial: v.service === "AIR_FREIGHT" ? { incoterm: v.incoterm } : undefined,
    declarations: v.declarations, declaredTotal: { amountMinor: declaredTotalMinor(v.items), currency: "GBP" },
    documentIds: v.docs.map((d) => d.documentId), consents: v.consents,
  }
}

export type StepId = "route" | "service" | "shipment" | "contact" | "review"

/**
 * A server problem path ("items[0].unitValue.amountMinor") as the wizard field key ("items.0.value") and its step.
 * Unknown paths land on the review step, where the problem detail is shown.
 */
export function mapServerPath(path: string): { step: StepId; key: string } {
  const key = path.replace(/\[(\d+)\]/g, ".$1")
  const head = key.split(".")[0]
  if (head === "laneId") return { step: "route", key }
  if (head === "service") return { step: "service", key }
  if (head === "items") return { step: "shipment", key: key.replace(/\.unitValue(\..*)?$/, ".value") }
  if (head === "commercial") return { step: "shipment", key: "incoterm" }
  if (head === "declaredTotal") return { step: "shipment", key: "items" }
  if (head && ["pieces", "readyDate", "handoverMode", "declarations"].includes(head)) return { step: "shipment", key }
  if (head === "shipper" || head === "consignee") return { step: "contact", key }
  if (head === "documentIds") return { step: "contact", key: "docs" }
  return { step: "review", key }
}
