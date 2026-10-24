import { Injectable } from "@nestjs/common"
import { eq, sql } from "drizzle-orm"

import { documentSequences, quotes, type Tx } from "@unitravel/db"
import { formatDocumentNumber, londonYear } from "@unitravel/domain"

import { ConfigService } from "../config/config.service"

/**
 * Gap-free document numbers (ADR-0006 C6). The counter row is incremented in the caller's transaction, so concurrent
 * issuers queue on the row lock and a rolled-back issue releases its number.
 */
@Injectable()
export class DocumentNumbersService {
  constructor(private readonly config: ConfigService) {}

  async allocate(tx: Tx, kind: "QUOTATION" | "INVOICE", now = new Date()): Promise<string> {
    const year = londonYear(now)
    const [row] = await tx.insert(documentSequences).values({ kind, year, lastValue: 1 })
      .onConflictDoUpdate({ target: [documentSequences.kind, documentSequences.year], set: { lastValue: sql`${documentSequences.lastValue} + 1` } })
      .returning({ value: documentSequences.lastValue })
    const cfg = this.config.settings().commercialDocuments
    return formatDocumentNumber(kind === "QUOTATION" ? cfg.quotePrefix : cfg.invoicePrefix, year, row!.value)
  }

  /** A quotation is the sent quote with a number (ADR-0006 C1); sending twice keeps the first number. */
  async assignQuotation(tx: Tx, quoteId: string, now = new Date()): Promise<string> {
    const [q] = await tx.select({ n: quotes.documentNumber }).from(quotes).where(eq(quotes.id, quoteId)).for("update")
    if (q?.n) return q.n
    const number = await this.allocate(tx, "QUOTATION", now)
    await tx.update(quotes).set({ documentNumber: number }).where(eq(quotes.id, quoteId))
    return number
  }
}
