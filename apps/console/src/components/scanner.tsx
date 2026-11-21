"use client"

import { Camera, CameraOff, Nfc, ScanLine } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"

import { useT } from "@/lib/i18n"
import { nfcSupported, readNfc } from "@/lib/nfc"

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type DetectorCtor = new (o: { formats: string[] }) => Detector

/** Label QR holds the tracking URL, the Code 128 barcode and NFC tags the number or URL: all contain UT + 11 digits. */
export const pickTn = (raw: string) => raw.toUpperCase().match(/UT\d{11}/)?.[0] ?? null

/** A frame reader: the native BarcodeDetector when present, otherwise jsQR on a downscaled frame (ADR-0045 D4). */
async function reader(v: HTMLVideoElement): Promise<() => Promise<string[]>> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  if (Native) {
    const d = new Native({ formats: ["qr_code", "code_128"] })
    return async () => (await d.detect(v)).map((c) => c.rawValue)
  }
  const jsQR = (await import("jsqr")).default
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  return async () => {
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight))
    canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale)
    if (!canvas.width || !canvas.height) return []
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })
    return r?.data ? [r.data] : []
  }
}

/**
 * Camera (QR/barcode), NFC (Android Chrome) and typed entry in one block. `onTn` gets each tracking number found;
 * the same number is ignored for `cooldownMs` so one label is not read on every frame. `keepOpen` leaves the camera
 * running after a hit (bulk scanning).
 */
export function Scanner({ onTn, keepOpen = false, cooldownMs = 2500, disabled = false }: { onTn: (tn: string) => Promise<unknown> | void; keepOpen?: boolean; cooldownMs?: number; disabled?: boolean }) {
  const t = useT()
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const nfcAbort = useRef<AbortController | null>(null)
  const last = useRef<{ tn: string; at: number } | null>(null)
  const busy = useRef(false)
  const [camera, setCamera] = useState<boolean | null>(null)
  const [nfc, setNfc] = useState(false)
  const [on, setOn] = useState(false)
  const [nfcOn, setNfcOn] = useState(false)
  const [manual, setManual] = useState("")
  const [err, setErr] = useState<string | null>(null)

  const stopCamera = useCallback(() => { stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null; setOn(false) }, [])
  const stopNfc = useCallback(() => { nfcAbort.current?.abort(); nfcAbort.current = null; setNfcOn(false) }, [])

  const hit = useCallback(async (raw: string) => {
    const tn = pickTn(raw)
    if (!tn) { setErr(t("agt.scan.bad")); return }
    const now = Date.now()
    if (busy.current || (last.current && last.current.tn === tn && now - last.current.at < cooldownMs)) return
    last.current = { tn, at: now }
    busy.current = true
    setErr(null)
    navigator.vibrate?.(60)
    if (!keepOpen) { stopCamera(); stopNfc() }
    try { await onTn(tn) } finally { busy.current = false }
  }, [cooldownMs, keepOpen, onTn, stopCamera, stopNfc, t])
  const hitRef = useRef(hit)
  hitRef.current = hit

  useEffect(() => { setCamera(!!navigator.mediaDevices?.getUserMedia); setNfc(nfcSupported()) }, [])
  useEffect(() => () => { stopCamera(); stopNfc() }, [stopCamera, stopNfc])

  const startCamera = async () => {
    setErr(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      stream.current = s
      setOn(true)
      const v = video.current!
      v.srcObject = s
      await v.play()
      const read = await reader(v)
      const tick = async () => {
        if (!stream.current) return
        if (!busy.current && v.readyState >= 2) {
          try {
            const found = (await read()).find((x) => pickTn(x))
            if (found) await hitRef.current(found)
          } catch { /* a frame that cannot be read: try the next one */ }
        }
        if (stream.current) setTimeout(() => void tick(), 250)
      }
      void tick()
    } catch {
      stopCamera()
      setErr(t("agt.scan.denied"))
    }
  }

  const startNfc = async () => {
    setErr(null)
    const ac = new AbortController()
    nfcAbort.current = ac
    setNfcOn(true)
    try { await readNfc((text) => void hitRef.current(text), (msg) => setErr(t("nfc.failed", { msg })), ac.signal) } catch (e) { setNfcOn(false); setErr(t("nfc.failed", { msg: e instanceof Error ? e.message : String(e) })) }
  }

  return (
    <div data-testid="scanner">
      <div className="relative aspect-[3/4] max-h-[60dvh] w-full overflow-hidden rounded-[var(--radius-card)] bg-ink/90" data-testid="scan-view">
        <video ref={video} playsInline muted className={on ? "size-full object-cover" : "hidden"} />
        {on && <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" aria-hidden />}
        {!on && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
            <div>
              {nfcOn ? <Nfc className="mx-auto mb-3 size-12 animate-pulse" aria-hidden /> : <ScanLine className="mx-auto mb-3 size-12 opacity-80" aria-hidden />}
              <p className="text-meta">{nfcOn ? t("nfc.reading") : camera === false ? t("agt.scan.noCamera") : t("agt.scan.hint")}</p>
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {camera && (on
          ? <Button variant="outline" className="w-full pointer-coarse:min-h-11" onClick={stopCamera}><CameraOff className="size-4" aria-hidden />{t("agt.scan.stop")}</Button>
          : <Button className="w-full pointer-coarse:min-h-11" onClick={() => void startCamera()} disabled={disabled} data-testid="scan-start"><Camera className="size-4" aria-hidden />{t("agt.scan.start")}</Button>)}
        {nfc && (nfcOn
          ? <Button variant="outline" className="w-full pointer-coarse:min-h-11" onClick={stopNfc}>{t("nfc.stop")}</Button>
          : <Button variant="outline" className="w-full pointer-coarse:min-h-11" onClick={() => void startNfc()} disabled={disabled} data-testid="nfc-start"><Nfc className="size-4" aria-hidden />{t("nfc.read")}</Button>)}
      </div>
      {err && <p role="alert" className="mt-3 rounded-sm bg-danger-subtle px-2 py-1.5 text-danger">{err}</p>}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); last.current = null; void hit(manual).then(() => setManual("")) }}>
        <label className="sr-only" htmlFor="tn">{t("agt.scan.manual")}</label>
        <Input id="tn" dir="ltr" autoCapitalize="characters" autoComplete="off" placeholder="UT00000000000" value={manual} onChange={(e) => setManual(e.target.value)} className="ref" disabled={disabled} data-testid="scan-manual" />
        <Button type="submit" variant="outline" disabled={disabled}>{t("agt.scan.open")}</Button>
      </form>
    </div>
  )
}
