"use client"

// Passkeys (WebAuthn) for the staff second factor (ch. 16.1). The API speaks @simplewebauthn's JSON shapes; these
// helpers convert them to and from the browser's ArrayBuffer-based credential API without another dependency.

const b64urlToBuf = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4)
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer
}
const bufToB64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

type Json = Record<string, unknown>
type Desc = { id: string; type: string; transports?: string[] }

export const webauthnSupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential

export async function createPasskey(opts: Json): Promise<Json> {
  const user = opts.user as { id: string; name: string; displayName: string }
  const publicKey = {
    ...opts,
    challenge: b64urlToBuf(opts.challenge as string),
    user: { ...user, id: b64urlToBuf(user.id) },
    excludeCredentials: ((opts.excludeCredentials as Desc[] | undefined) ?? []).map((c) => ({ ...c, id: b64urlToBuf(c.id) })),
  } as unknown as PublicKeyCredentialCreationOptions
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null
  if (!cred) throw new Error("Passkey creation was cancelled")
  const r = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: { clientDataJSON: bufToB64url(r.clientDataJSON), attestationObject: bufToB64url(r.attestationObject), transports: r.getTransports?.() ?? [] },
  }
}

export async function getPasskey(opts: Json): Promise<Json> {
  const publicKey = {
    ...opts,
    challenge: b64urlToBuf(opts.challenge as string),
    allowCredentials: ((opts.allowCredentials as Desc[] | undefined) ?? []).map((c) => ({ ...c, id: b64urlToBuf(c.id) })),
  } as unknown as PublicKeyCredentialRequestOptions
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null
  if (!cred) throw new Error("Passkey sign-in was cancelled")
  const r = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: { clientDataJSON: bufToB64url(r.clientDataJSON), authenticatorData: bufToB64url(r.authenticatorData), signature: bufToB64url(r.signature), userHandle: r.userHandle ? bufToB64url(r.userHandle) : undefined },
  }
}
