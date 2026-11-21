/** ADR-0042 tracking numbers: `UT` + 11 digits. Customers may type spaces, dashes or lower case; the API tolerates them too. */
export const normaliseTrackingNumber = (raw: string) => raw.replace(/[\s-]/g, "").toUpperCase()
export const isTrackingNumber = (n: string) => /^UT\d{11}$/.test(n)
