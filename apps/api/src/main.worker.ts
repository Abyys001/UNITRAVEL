import "reflect-metadata"

import { NestFactory } from "@nestjs/core"
import { Logger } from "nestjs-pino"

import { AppModule } from "./app.module"

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule.forRole("worker"), { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.enableShutdownHooks()
  await app.init()
}

void main()
