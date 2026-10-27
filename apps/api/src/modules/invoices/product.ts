export type Product = "FLIGHT" | "CARGO" | "SERVICE"

/** The commercial product behind a request_type value (AFTER_SALES cases are flight business). */
export const productOf = (requestType: string): Product => (requestType === "CARGO" ? "CARGO" : requestType === "SERVICE" ? "SERVICE" : "FLIGHT")
