"use client"

/**
 * ADR-0046 D1: Web NFC (Chrome on Android only). Types are declared here because Web NFC is not in TypeScript's DOM lib.
 * Tags carry the signed tracking URL (or the bare tracking number); they never sign anyone in.
 */
type NdefRecord = { recordType: string; data?: DataView; encoding?: string }
type NdefReadingEvent = Event & { message: { records: NdefRecord[] }; serialNumber: string }
interface NdefReaderLike extends EventTarget {
  scan(o?: { signal?: AbortSignal }): Promise<void>
  write(message: { records: { recordType: string; data: string }[] }, o?: { signal?: AbortSignal; overwrite?: boolean }): Promise<void>
}
type NdefCtor = new () => NdefReaderLike

const ctor = (): NdefCtor | null => (typeof window !== "undefined" && "NDEFReader" in window ? (window as unknown as { NDEFReader: NdefCtor }).NDEFReader : null)

export const nfcSupported = () => !!ctor()

/** Reads tags until the signal aborts; every text/URL record is handed to onText. */
export async function readNfc(onText: (text: string) => void, onError: (msg: string) => void, signal: AbortSignal) {
  const C = ctor()
  if (!C) throw new Error("Web NFC is not available")
  const r = new C()
  r.addEventListener("reading", (e) => {
    for (const rec of (e as NdefReadingEvent).message.records) {
      if (!rec.data || !["url", "absolute-url", "text"].includes(rec.recordType)) continue
      onText(new TextDecoder(rec.encoding ?? "utf-8").decode(rec.data))
    }
  })
  r.addEventListener("readingerror", () => onError("The tag could not be read"))
  await r.scan({ signal })
}

/** Writes one URL record; the tag then opens public tracking on any phone (iPhones read NDEF URLs natively). */
export async function writeNfc(url: string, signal?: AbortSignal) {
  const C = ctor()
  if (!C) throw new Error("Web NFC is not available")
  await new C().write({ records: [{ recordType: "url", data: url }] }, { signal, overwrite: true })
}
