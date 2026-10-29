/** Feature flags that gate parts of the long-form pages; the web decides which are on (settings arrive in a later phase). */
export type ContentFlag = "services.visa.enabled" | "services.insurance.enabled" | "payments.online.enabled" | "hotels.enabled"

export type Block =
  | { kind: "p"; text: string; flag?: ContentFlag }
  | { kind: "ol"; items: string[]; flag?: ContentFlag }
  | { kind: "ul"; items: string[]; flag?: ContentFlag }
  /** In-app link: `href` has no locale prefix (the page adds it). */
  | { kind: "link"; href: string; text: string; flag?: ContentFlag }
  /** Term and definition pairs (glossaries, accommodation types, meal plans); `code` is an optional short label such as "BB". */
  | { kind: "dl"; items: Term[]; flag?: ContentFlag }

export interface Term { term: string; text: string; code?: string }

export interface Item {
  id: string
  heading: string
  blocks: Block[]
  /** The whole item (heading included) renders only when this flag is on. */
  flag?: ContentFlag
}

export interface Content { en: Item[]; fa: Item[] }

export type ContentFlags = Partial<Record<ContentFlag, boolean>>

/** Drops items and blocks whose flag is off; content without a flag is always shown. */
export function visibleItems(items: readonly Item[], flags: ContentFlags = {}): Item[] {
  const on = (f?: ContentFlag) => !f || flags[f] === true
  return items.filter((i) => on(i.flag)).map((i) => ({ ...i, blocks: i.blocks.filter((b) => on(b.flag)) }))
}
