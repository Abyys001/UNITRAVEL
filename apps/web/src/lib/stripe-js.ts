"use client"

interface EmbeddedCheckout { mount(target: string | HTMLElement): void; destroy(): void }
interface StripeJs {
  initEmbeddedCheckout?: (o: { fetchClientSecret: () => Promise<string> }) => Promise<EmbeddedCheckout>
  initEmbeddedCheckoutPage?: (o: { fetchClientSecret: () => Promise<string> }) => Promise<EmbeddedCheckout>
}
declare global { interface Window { Stripe?: (publishableKey: string) => StripeJs } }

let loading: Promise<NonNullable<Window["Stripe"]>> | null = null

/** Stripe asks for js.stripe.com to be loaded from Stripe itself (never bundled). The CSP allows it on the pay page only. */
export function loadStripeJs() {
  loading ??= new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe)
    const s = document.createElement("script")
    s.src = "https://js.stripe.com/v3/"
    s.async = true
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js did not initialise")))
    s.onerror = () => { loading = null; reject(new Error("Stripe.js could not be loaded")) }
    document.head.appendChild(s)
  })
  return loading
}

export async function mountEmbeddedCheckout(publishableKey: string, clientSecret: string, target: HTMLElement): Promise<() => void> {
  const stripe = (await loadStripeJs())(publishableKey)
  // `embedded_page` sessions are mounted with the embedded checkout initialiser of the loaded Stripe.js version.
  const init = stripe.initEmbeddedCheckoutPage ?? stripe.initEmbeddedCheckout
  if (!init) throw new Error("This Stripe.js version has no embedded checkout")
  const checkout = await init.call(stripe, { fetchClientSecret: async () => clientSecret })
  checkout.mount(target)
  return () => checkout.destroy()
}
