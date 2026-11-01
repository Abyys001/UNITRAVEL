import { index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"

import { id, tstz } from "./columns"
import { users } from "./identity"

// ADR-0018: screen names and sign-in/out events only. No content, no free text, no full IP. Pruned after 90 days by the worker.
export const customerActivity = pgTable("customer_activity", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  sessionId: uuid(),
  kind: text({ enum: ["SIGN_IN", "SIGN_OUT", "SCREEN_VIEW"] }).notNull(),
  screen: varchar({ length: 40 }),
  ref: varchar({ length: 32 }),
  client: text({ enum: ["WEB", "MOBILE", "CONSOLE"] }),
  /** /24 (IPv4) or /48 (IPv6) prefix, never the full address. */
  network: varchar({ length: 64 }),
  occurredAt: tstz().notNull().defaultNow(),
}, (t) => [index("customer_activity_user_idx").on(t.userId, t.occurredAt), index("customer_activity_at_idx").on(t.occurredAt)])
