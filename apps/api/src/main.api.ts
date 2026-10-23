import { createApi, openApiDocument } from "./bootstrap"
import { env, isLocal } from "./core/env"
import { SwaggerModule } from "@nestjs/swagger"

async function main() {
  const app = await createApi()
  if (isLocal()) SwaggerModule.setup("docs", app, openApiDocument(app))
  await app.listen(env().PORT)
}

void main()
