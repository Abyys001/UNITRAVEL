/**
 * Error details that are safe to log or store (ch. 28.5). Database driver errors carry the failed query's parameters in
 * their message ("Failed query: … params: +4477…,neda@…"), and pino's key-based redaction cannot see inside a string,
 * so the message is cut at the parameters and anything shaped like an email, phone or long number is masked.
 */
export function scrubMessage(message: string): string {
  return message
    .split(/\n\s*params:/i)[0]!
    .replace(/[^\s@,;:'"<>()]+@[^\s@,;:'"<>()]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[number]")
    .slice(0, 500)
}

export interface SafeError { name: string; message: string; code?: string; constraint?: string; table?: string; stack?: string }

export function safeError(err: unknown): SafeError {
  if (!(err instanceof Error)) return { name: "NonError", message: scrubMessage(String(err)) }
  // pg's DatabaseError sits on `cause` when drizzle wraps it.
  const pg = (err as { cause?: { code?: string; constraint?: string; table?: string } }).cause ?? (err as { code?: string; constraint?: string; table?: string })
  const frames = err.stack?.split("\n").filter((l) => /^\s+at /.test(l)).slice(0, 8).join("\n")
  return { name: err.name, message: scrubMessage(err.message), code: typeof pg.code === "string" ? pg.code : undefined, constraint: pg.constraint, table: pg.table, stack: frames }
}
