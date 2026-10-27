import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool, type PoolConfig } from "pg"

import * as schema from "./schema"

export * as schema from "./schema"
export * from "./schema"
export { uuidv7 } from "./schema/columns"
export { providerSeedRows, shouldSeedDemo } from "./seed/providers"

export type Db = NodePgDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export type DbOrTx = Db | Tx

export function createDb(url: string, config: PoolConfig = {}): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 20, ...config })
  return { db: drizzle(pool, { schema, casing: "snake_case" }), pool }
}
