import { eq } from "drizzle-orm"

import type { Money, SegmentBaggage, Slice } from "@unitravel/contracts"
import { type DbOrTx, users } from "@unitravel/db"
import { type Locale, translate } from "@unitravel/i18n"

import type { PdfSection } from "../documents/pdf"

/** The customer's locale, zone and calendar: quotation dates follow them, with the zone named (ch. 17.4), exactly as notifications do. */
export interface DocZone { locale: Locale; tz: string; calendar: "GREGORIAN" | "JALALI" }
export const DEFAULT_ZONE: DocZone = { locale: "en", tz: "Europe/London", calendar: "GREGORIAN" }

type Cond = { status: "KNOWN"; value: { allowed: boolean; penalty?: Money } } | { status: "UNKNOWN" }
export interface QuotationOptionRow { label: string; ticketingModel: string; itinerary: unknown; baggage: unknown; conditions: unknown; priceBreakdown: unknown }
export interface QuotationTraveller { passengerType: string; nameSnapshot: { title: string; givenNames: string; surname: string; nameFa: string | null } }

const LABELS = {
  en: {
    quotation: "quotation", validUntil: "Valid until", option: "Option", traveller: "Traveller", baggage: "Baggage", ticketing: "Ticketing", single: "Single ticket (protected connections)", separate: "Separate tickets (self-transfer)",
    fareTaxes: "Fare + taxes", serviceFee: "Service fee", discount: "Discount", total: "Total", local: "local", unknown: "UNKNOWN", issuedBy: "Issued by", flightTitle: "Your travel options", cargoTitle: "Your shipment quotation",
    pax: { ADT: "Adult", CHD: "Child", INF: "Infant", INS: "Infant (seat)", YTH: "Youth", STU: "Student" } as Record<string, string>,
    charges: "Charges", transit: "Transit", pieces: "Pieces", piece: "Piece", actual: "Actual weight", chargeable: "Chargeable weight (estimate)", estimate: "estimate", payableBy: "Payable by recipient", duties: "Duties and taxes",
    flightFooter: "This is a quotation, not a booking: seats are reserved only after you accept and our team confirms the reservation.", cargoFooter: "This is a quotation, not a booking: your shipment is booked only after you accept and our team confirms it. Uni Travel arranges shipments through partners and does not operate transport itself.",
  },
  fa: {
    quotation: "پیشنهاد قیمت", validUntil: "اعتبار تا", option: "گزینه", traveller: "مسافر", baggage: "بار", ticketing: "نوع بلیت", single: "بلیت واحد (پرواز متصل با پوشش کامل)", separate: "بلیت‌های جداگانه (انتقال شخصی)",
    fareTaxes: "نرخ + مالیات", serviceFee: "کارمزد خدمات", discount: "تخفیف", total: "جمع", local: "به وقت محلی", unknown: "نامشخص", issuedBy: "صادرکننده", flightTitle: "گزینه‌های سفر شما", cargoTitle: "پیشنهاد قیمت محموله شما",
    pax: { ADT: "بزرگسال", CHD: "کودک", INF: "نوزاد", INS: "نوزاد (با صندلی)", YTH: "جوان", STU: "دانشجو" } as Record<string, string>,
    charges: "هزینه‌ها", transit: "زمان حمل", pieces: "بسته‌ها", piece: "بسته", actual: "وزن واقعی", chargeable: "وزن قابل محاسبه (برآورد)", estimate: "برآورد", payableBy: "پرداخت با گیرنده", duties: "حقوق و عوارض",
    flightFooter: "این یک پیشنهاد قیمت است، نه رزرو: صندلی فقط پس از پذیرش شما و تأیید رزرو توسط تیم ما رزرو می‌شود.", cargoFooter: "این یک پیشنهاد قیمت است، نه رزرو: محموله شما فقط پس از پذیرش شما و تأیید تیم ما رزرو می‌شود. یونی تراول محموله‌ها را از طریق شرکای خود ترتیب می‌دهد و خودش حمل نمی‌کند.",
  },
} as const
export const docLabels = (l: Locale) => LABELS[l]

export async function customerZone(tx: DbOrTx, userId: string): Promise<DocZone> {
  const [u] = await tx.select({ locale: users.preferredLocale, tz: users.timezone, calendar: users.calendar }).from(users).where(eq(users.id, userId))
  return u ?? DEFAULT_ZONE
}

/** "24 Oct 2026, 20:36 BST": the zone is always named so a customer abroad never has to guess which clock is meant. */
export function formatValidity(at: Date, z: DocZone): string {
  const loc = z.locale === "fa" ? (z.calendar === "JALALI" ? "fa-IR-u-ca-persian" : "fa-IR-u-ca-gregory") : z.calendar === "JALALI" ? "en-GB-u-ca-persian" : "en-GB"
  return new Intl.DateTimeFormat(loc, { timeZone: z.tz, year: "numeric", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(at)
}

/** Ordinals in labels follow the document language ("گزینه ۱"); amounts and times stay Latin. */
const ord = (n: number, z: DocZone) => (z.locale === "fa" ? String(n).replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d))) : String(n))
const money = (m: Money) => `${m.currency} ${(m.amountMinor / 100).toFixed(2)}`
const unknown = (z: DocZone) => `${LABELS[z.locale].unknown}: ${translate(z.locale, "itinerary.unknown")}`

/** Checked bag per segment, tri-state: known (pieces / none) or UNKNOWN, never inferred (CLAUDE.md rule 3). */
export function baggageText(entries: SegmentBaggage[], z: DocZone): string {
  if (!entries.length) return unknown(z)
  return entries.map((b) => {
    const t = b.checked.status === "UNKNOWN" ? unknown(z) : !b.checked.value.pieces ? translate(z.locale, "itinerary.noChecked") : b.checked.value.kgPerPiece ? translate(z.locale, "itinerary.bags", { pieces: b.checked.value.pieces, kg: b.checked.value.kgPerPiece }) : translate(z.locale, "itinerary.bagsPieces", { pieces: b.checked.value.pieces })
    return entries.length > 1 ? `${t} (${LABELS[z.locale].pax[b.passengerType] ?? b.passengerType})` : t
  }).join("; ")
}

export function conditionText(c: Cond | undefined, z: DocZone): string {
  if (!c || c.status === "UNKNOWN") return unknown(z)
  if (!c.value.allowed) return translate(z.locale, "itinerary.notAllowed")
  return c.value.penalty && c.value.penalty.amountMinor > 0 ? translate(z.locale, "itinerary.allowedFee", { fee: money(c.value.penalty) }) : translate(z.locale, "itinerary.allowed")
}

const travellerName = (t: QuotationTraveller, z: DocZone) => {
  const n = t.nameSnapshot
  const latin = `${n.title} ${n.givenNames} ${n.surname.toUpperCase()}`
  return `${z.locale === "fa" && n.nameFa ? `${n.nameFa} - ` : ""}${latin} (${LABELS[z.locale].pax[t.passengerType] ?? t.passengerType})`
}

type Row = [string, string]

/** One section per quoted option: travellers, every segment with its baggage, fare conditions and price. */
export function flightOptionSections(opts: QuotationOptionRow[], travellers: QuotationTraveller[], z: DocZone): PdfSection[] {
  const L = LABELS[z.locale]
  return opts.map((o, i) => {
    const segs = (o.itinerary as { slices: Slice[] }).slices.flatMap((s) => s.segments)
    const bags = o.baggage as SegmentBaggage[]
    const cond = o.conditions as { change?: Cond; refund?: Cond }
    const pb = o.priceBreakdown as { fare: Money; taxes: Money; serviceFee: Money; extras?: { label: string; amount: Money }[]; discount?: { label: string; amount: Money }; total: Money }
    const rows: Row[] = [
      ...travellers.map((t, n): Row => [`${L.traveller} ${ord(n + 1, z)}`, travellerName(t, z)]),
      ...segs.flatMap((g, si): Row[] => [
        [`${g.marketing.carrier}${g.marketing.flightNumber}`, `${g.origin.iata} - ${g.destination.iata} · ${g.departure.local.replace("T", " ")} ${L.local}`],
        [`${L.baggage} ${g.marketing.carrier}${g.marketing.flightNumber}`, baggageText(bags.filter((b) => b.segmentIndex === si), z)],
      ]),
      [translate(z.locale, "itinerary.change"), conditionText(cond.change, z)],
      [translate(z.locale, "itinerary.refund"), conditionText(cond.refund, z)],
      [L.ticketing, o.ticketingModel === "SINGLE_TICKET" ? L.single : L.separate],
      [L.fareTaxes, `${money(pb.fare)} + ${money(pb.taxes)}`], [L.serviceFee, money(pb.serviceFee)],
      ...(pb.extras ?? []).map((e): Row => [e.label, money(e.amount)]),
      ...(pb.discount ? [[`${L.discount} · ${pb.discount.label}`, `- ${money(pb.discount.amount)}`] as Row] : []),
      [L.total, money(pb.total)],
    ]
    return { heading: `${L.option} ${ord(i + 1, z)} · ${o.label}`, rows }
  })
}

export interface CargoPiece { lengthCm: number; widthCm: number; heightCm: number; weightKg: number; verifiedWeightKg: number | null }

export function cargoSections(args: { currency: string; lines: { freight: { chargeableKg: number; amount: Money }; fuelSurcharge: Money; securitySurcharge: Money; handling: Money; customsBrokerage: Money; insurance: Money; pickup: Money; delivery: Money; total: Money; dutiesTaxes: Money | "PAYABLE_BY_CONSIGNEE"; dutiesEstimate: boolean }; pieces: CargoPiece[]; weights: { actualKg: number; chargeableKg: number }; transitNote: string | null }, z: DocZone): PdfSection[] {
  const L = LABELS[z.locale]
  const c = args.lines
  const q = (k: "freight" | "fuel" | "security" | "handling" | "customs" | "insurance" | "pickup" | "delivery") => translate(z.locale, `cargo.quoteLines.${k}`)
  const charges: Row[] = [[`${q("freight")} (${c.freight.chargeableKg} kg)`, money(c.freight.amount)], [q("fuel"), money(c.fuelSurcharge)], [q("security"), money(c.securitySurcharge)], [q("handling"), money(c.handling)], [q("customs"), money(c.customsBrokerage)], [q("insurance"), money(c.insurance)], [q("pickup"), money(c.pickup)], [q("delivery"), money(c.delivery)],
    [L.duties, c.dutiesTaxes === "PAYABLE_BY_CONSIGNEE" ? L.payableBy : `${money(c.dutiesTaxes)}${c.dutiesEstimate ? ` (${L.estimate})` : ""}`], [L.total, money(c.total)]]
  const pieces: Row[] = [
    ...args.pieces.map((p, i): Row => [`${L.piece} ${ord(i + 1, z)}`, `${p.lengthCm} x ${p.widthCm} x ${p.heightCm} cm · ${p.verifiedWeightKg ?? p.weightKg} kg`]),
    [L.actual, `${args.weights.actualKg} kg`], [L.chargeable, `${args.weights.chargeableKg} kg`],
  ]
  return [{ heading: L.pieces, rows: pieces }, { heading: L.charges, rows: charges }, ...(args.transitNote ? [{ heading: L.transit, paragraphs: [args.transitNote] }] : [])]
}

/** Wording pending counsel review (CLAUDE.md rule 7); the Persian text mirrors the English one and stays marked the same. */
export function atolFooter(payOnTicketing: boolean, locale: Locale): string {
  if (locale === "fa") return payOnTicketing ? "بلیت‌ها به‌عنوان نماینده فروش بلیت ایرلاین فروخته می‌شوند: وجه فقط هنگام صدور بلیت دریافت می‌شود و این پرواز تحت پوشش ATOL نیست (متن در انتظار بررسی مشاور حقوقی)." : "جزئیات پوشش ATOL همراه گواهی ATOL شما ارائه می‌شود."
  return payOnTicketing ? "Flights are sold as an airline ticket agent: payment is taken only when tickets are issued; this flight is not ATOL protected (wording pending counsel review)." : "ATOL protection details are provided with your ATOL Certificate."
}
