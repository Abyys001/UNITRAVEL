import { integer, timestamp, uuid } from "drizzle-orm/pg-core"
import { v7 as uuidv7 } from "uuid"

/** UUID v7 (time-ordered) generated in the application (ch. 23.2). */
export const id = () => uuid().primaryKey().$defaultFn(() => uuidv7())
export const tstz = () => timestamp({ withTimezone: true, mode: "date" })
export const createdAt = () => tstz().notNull().defaultNow()
export const updatedAt = () => tstz().notNull().defaultNow().$onUpdate(() => new Date())
export const timestamps = { createdAt: createdAt(), updatedAt: updatedAt() }
/** Optimistic locking for aggregates staff edit (ch. 20.5). */
export const rowVersion = () => integer().notNull().default(1)
export { uuidv7 }
