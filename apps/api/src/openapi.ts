import { writeFileSync } from "node:fs"
import path from "node:path"

import { createApi, openApiDocument } from "./bootstrap"

/** CI artefact (ch. 19.5): OpenAPI generated from Zod schemas + controllers; breaking changes are diffed. */
async function main() {
  const app = await createApi()
  await app.init()
  const doc = openApiDocument(app)
  writeFileSync(path.resolve(__dirname, "../../../packages/contracts/openapi.json"), JSON.stringify(doc, null, 2))
  await app.close()
  console.log(`openapi.json written: ${Object.keys(doc.paths).length} paths`)
}

void main()
