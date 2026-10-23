import { applyDecorators, Injectable, type PipeTransform } from "@nestjs/common"
import { ApiBody, ApiQuery, ApiResponse } from "@nestjs/swagger"
import { type ZodType, z } from "zod"

/** Validates params, query and body against the contracts schemas (ch. 20.4 step 5). Unknown fields are rejected. */
@Injectable()
export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const r = this.schema.safeParse(value)
    if (!r.success) throw r.error
    return r.data
  }
}

export const zbody = <T extends ZodType>(schema: T) => new ZodPipe(schema)

export function openApiSchema(schema: ZodType, io: "input" | "output" = "input"): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any", io }) as Record<string, unknown>
  delete json.$schema
  return json
}

export const ApiZodBody = (schema: ZodType) => ApiBody({ schema: openApiSchema(schema) as never })
export const ApiZodResponse = (status: number, schema: ZodType, description = "OK") => ApiResponse({ status, description, schema: openApiSchema(schema, "output") as never })
export function ApiZodQuery(schema: z.ZodObject) {
  return applyDecorators(...Object.entries(schema.shape).map(([name, field]) => ApiQuery({ name, required: !(field as ZodType).safeParse(undefined).success, schema: openApiSchema(field as ZodType) as never })))
}

/** Serialise output through the response schema so internal fields can never leak (ch. 20.4 step 8). */
export function serialise<T extends ZodType>(schema: T, value: unknown): z.output<T> {
  return schema.parse(value)
}
