# Content, menu and live data (27 Oct 2026): spec and change plan

Source: owner message of 27 Oct 2026 (Persian): FAQ, "rules and important notes for domestic and international
flights", the "Buying flight tickets at Uni Travel" page, "no test and non-test: all data live, especially flights,
change the backend now", and the new site menu with one behaviour per item.
Reviewed against commit `7964b8a`.

> **Numbering (27 Oct 2026, implementation):** work found uncommitted on the staging VPS already used ADR-0013, STAGE-13 and
> migration 0009 (staff amendments, price lines, payment emails). This spec's numbers moved by one: ADR-0014 (live data),
> ADR-0015 (service requests), ADR-0016 (club); STAGE-14/15/16; migrations 0010 (service requests) and 0011 (club).
> **O11 changed by the owner the same day:** test sign-in stays on staging until real email exists (ADR-0014).

Three phases, run in order, each ending with a `docs/stages/STAGE-N.md` record:

| Phase | What | ADR | Stage record |
|---|---|---|---|
| **G** | Live data only on every deployed host (flights first); remove FAKE, sandbox and test sign-in from VPS hosts | ADR-0014 | STAGE-14 |
| **H** | Content pages: FAQ, travel rules, flight-buying guide (fa + en) | none (content) | STAGE-15 |
| **I** | New menu, service requests (visa, tours, CIP, insurance), purchase tracking, support, customer club; hotel/villa/train/bus ports | ADR-0015 (D-04 deviation), ADR-0016 (club) | STAGE-16 |

Rule reminders that shape every section below (CLAUDE.md): no fabricated data (rule 2), truth model and UNKNOWN baggage
(rule 3), backend authority and state machines (rule 4), compliance policies are data (rule 5), en + fa strings for
everything users see, ADR before deviating from the booklet (rule 10).

---

## 1. Owner decisions needed before or during the build

Several requests conflict with decisions already **DECIDED** in the booklet or ADRs. This spec builds the
**proposed default** column until the owner (and counsel where named) decides otherwise. Nothing here weakens a
compliance policy in code.

| # | Request | Conflicts with | Proposed default (what gets built) | Status |
|---|---|---|---|---|
| O1 | "Domestic and international" flights (FAQ 1, guide) | D-01: every Iranian-registered carrier is BLOCK. Flights inside Iran are operated by Iranian carriers (INFERRED; verify) | Content says international only; "داخلی" wording removed or answered "not offered" | Owner + counsel |
| O2 | Instalment purchase (FAQ 2, guide) | `atol.mode = PAY_ON_TICKETING` (booklet 27, ch. on ATOL): payment only at ticketing, **no deposits**, no PARTIAL | FAQ answers "not available at present"; guide bullet replaced by "pay only when the ticket is issued" | Counsel (only changes if `atol.mode` changes) |
| O3 | "Credit payment and easy payment methods" | Same as O2; Stripe live is BLOCKED (ADR-0007) | Describe staff-confirmed payment; card online only when `payments.online.enabled` is on | Owner (Stripe + counsel) |
| O4 | "Best price" and "price-change notifications" | ADR-0004: customers see no amounts before a sent quote | "Checked fares" instead of "best price" (comparative price claims need evidence, INFERRED UK advertising rules); "we tell you if a quoted fare changes before ticketing" | Owner |
| O5 | "Online refund" | Refunds are after-sales, staff-run, four-eyes above threshold | "Request a refund or change online" | Owner |
| O6 | Visa service (order) | New service. UK immigration advice/services are regulated (Immigration Advice Authority registration, INFERRED) | Request flow built, flag `services.visa.enabled` **off** until counsel confirms scope | Counsel |
| O7 | Travel insurance (request) | UK SI 2026/983 insurance restrictions for persons connected with Iran (booklet finding); insurance distribution is FCA-regulated (INFERRED) | Request flow built, flag **off** until counsel | Counsel |
| O8 | Hotel, villa, train, bus listings, live | D-04 (DECIDED): v1 is flights only. No provider contracted for any of them. Iranian domestic suppliers raise sanctions questions | ADR-0015; supplier ports built; each vertical hidden until a provider is contracted, configured and enabled. Never fake listings | Owner + counsel + contracts |
| O8b | Do hotel/villa listings show prices? | ADR-0004 scope | Same rule as flights (no amounts before a quote) until the owner says otherwise | Owner |
| O9 | CIP at Imam Khomeini (IKA) | Service bought from an Iranian airport operator (sanctions question) | Request flow built, flag **off** until counsel | Counsel |
| O10 | Tours ("should make a call") | Packages with flights can be package travel / ATOL (INFERRED) | Call-back request only; no package sale | Owner + counsel |
| O11 | "No test and non-test" | ADR-0007 (Stripe test only), ADR-0012 (test sign-in) | Phase G: deployed hosts use live data only; online payment stays **off** until Stripe live is approved; test sign-in removed. FAKE remains only for automated tests on developer machines and CI (`APP_ENV=local`) | DECIDED by this request (owner) |
| O12 | Customer club discounts and bonuses | Invoice amounts are frozen (ADR-0006); VAT treatment UNKNOWN (accountant) | Benefits applied by staff as a quote line; bonus credit has no cash value | Accountant |
| O13 | Support by email and phone | `settings.app.company.phone/email` hold placeholders (`+44 20 0000 0000`, `help@unitravel.example`) | Support page reads settings; real values entered in Developer Panel › Settings | UNKNOWN (client to supply) |
| O14 | "Safar card" | Owner: future, do not develop | Not built, not in the menu | DECIDED (owner) |
| O15 | "24-hour support, even on holidays" | Staffing hours are UNKNOWN | Claim only after the client confirms; hours come from settings | UNKNOWN (client) |

---

## 2. Phase G: live data only (flights first)

### 2.1 What happens today (OBSERVED in code)

- `FakeAdapter` refuses only `APP_ENV=production`. A VPS running `APP_ENV=staging` registers it, and the seed inserts
  the `fake` provider row **enabled**, so staging search results include FAKE offers labelled "TEST DATA"
  (`apps/api/src/modules/suppliers/adapters/fake.adapter.ts`, `packages/db/src/seed/index.ts` line ~74).
- `SuppliersService.envName()` returns `"test"` for every `APP_ENV` except production, so staging reads **test**
  credentials: a Duffel test token there returns Duffel's sandbox content, not real flights
  (`apps/api/src/modules/suppliers/suppliers.service.ts`, `envName()` and `credentials()`).
- The FAKE payment adapter and `fakeAvailable` follow the same "not production" rule
  (`apps/api/src/modules/payments/payment-config.service.ts` `fakeAllowed`, `fake-payment.adapter.ts`).
- `TEST_SIGN_IN` is `on` in `.env.example`; staging demo users are seeded unless `SEED_DEMO=0`.
- Amadeus Enterprise declares no capabilities until the contract and WSDL exist (BLOCKED, Stage 0). Duffel is
  implemented (search, price, seat maps) but disabled in the seed.

So "live flights" today depends on one thing the code cannot supply: a **live Duffel access token** (and later the
Amadeus contract). After Phase G a deployed host has exactly two possible states: live results, or the honest
"no live sources" notice (`NO_SOURCES`, already shown by `apps/web/src/app/[locale]/search/page.tsx`) with "Ask our
team". It never shows sandbox or FAKE results.

### 2.2 ADR-0014 (write first): live data only on deployed hosts

Decision: `APP_ENV=local` is the only place where FAKE adapters, sandbox credentials, the FAKE payment simulator,
demo users and test sign-in exist. `staging` and `production` behave the same for data: live providers only.
Consequences: staging cannot exercise Stripe or Duffel sandboxes; online payment stays off on every deployed host until
Stripe live mode is approved (ADR-0007 unchanged); automated tests keep running against FAKE locally and in CI.

### 2.3 Code changes (exact)

**G1. FAKE flight adapter: local only.**
`apps/api/src/modules/suppliers/adapters/fake.adapter.ts`, constructor:

```ts
import { isLocal } from "../../../core/env"
// ...
constructor() {
  if (!isLocal()) throw new Error("The FAKE supplier adapter only runs with APP_ENV=local (ADR-0014)")
}
```

`apps/api/src/modules/suppliers/suppliers.service.ts`, constructor (no warning noise on VPS boots):

```ts
const list: FlightSupplierAdapter[] = [new DuffelAdapter(), new AmadeusEnterpriseAdapter(), new ManualAdapter()]
if (isLocal()) list.push(new FakeAdapter())
for (const a of list) this.adapters.set(a.id, a)
```

`apps/api/src/modules/suppliers/dev-providers.controller.ts`, `patch()`: replace the production-only check with

```ts
if (id === "fake" && !isLocal()) throw new AppError("VALIDATION_FAILED", "The FAKE adapter only exists with APP_ENV=local (ADR-0014)")
```

**G2. One provider environment outside local.**
`suppliers.service.ts`:

```ts
private envName(): "test" | "production" {
  return isLocal() ? "test" : "production"
}
```

Credentials are stored per environment (`provider_credentials`), so a staging database simply holds its own live
token under `production`. `searchable()` needs no change.

**G3. Refuse sandbox tokens outside local.** `apps/api/src/modules/suppliers/adapters/duffel.adapter.ts`, in
`call()` after reading the token:

```ts
if (ctx.environment === "production" && token.startsWith("duffel_test_")) {
  throw new SupplierError("SUPPLIER_AUTH", "A Duffel test token cannot serve live searches (ADR-0014)")
}
```

and in `SuppliersService.setCredentials()` reject the same prefix when `!isLocal()` with
`AppError("VALIDATION_FAILED", ...)`, so the Developer Panel refuses it at entry. The `duffel_test_` / `duffel_live_`
prefixes are INFERRED from Duffel's token format; confirm in the Duffel dashboard before relying on the check.

**G4. Seed.** `packages/db/src/seed/index.ts`, providers block:

```ts
const local = (process.env.APP_ENV ?? "local") === "local"
const envFor = local ? "test" : "production"
await db.insert(s.providers).values([
  ...(local ? [{ id: "fake", /* unchanged */ }] : []),
  { id: "duffel", /* unchanged */, environment: envFor, enabled: false },
  { id: "amadeus-enterprise", /* unchanged */, environment: envFor, enabled: false },
  { id: "manual", /* unchanged */ },
]).onConflictDoNothing()
```

Demo users: change the guard at line ~180 from `APP_ENV !== "production"` to `local` (the variable defined at
line ~150), so no deployed host gets demo accounts.

**G5. Existing staging database (one-off, run by the developer with the migrate role):**

```sql
UPDATE providers SET enabled = false WHERE id = 'fake';            -- keep the row: provider_calls references it
UPDATE providers SET environment = 'production' WHERE id IN ('duffel', 'amadeus-enterprise');
```

Then deactivate the seeded demo accounts in Developer Panel › Users and clear Valkey `perm:*` if roles change.

**G6. Payments.** `apps/api/src/modules/payments/payment-config.service.ts`:
`const fakeAllowed = () => isLocal()`; `fake-payment.adapter.ts` constructor refuses `!isLocal()`; the Developer
Panel refuses Stripe `test` mode outside local (add the check where `canEnterStripeMode` is evaluated, with a message
that cites ADR-0014). `payments.online.enabled` stays `false` on deployed hosts; customers pay offline as today.

**G7. Test sign-in removal (ADR-0012 removal list).** Immediately on the VPS: `TEST_SIGN_IN=off`, `SEED_DEMO=0` in
the server `.env`, then restart. In code, delete the feature and keep the production refusal in `env.ts` as a net:

- API: `apps/api/src/modules/identity/auth.controller.ts` (both `test-sign-in` routes),
  `apps/api/src/modules/identity/otp.service.ts` (test sign-in method), `apps/api/test/test-sign-in.e2e.ts`
- Contracts: `packages/contracts/src/auth.ts` (test sign-in schemas); regenerate `packages/contracts/openapi.json`
- UI: `packages/ui/src/product/test-sign-in.tsx`, its use in `apps/web/src/app/[locale]/sign-in/page.tsx` and
  `apps/console/src/components/sign-in.tsx`; e2e helpers `apps/web/e2e/identity.spec.ts`,
  `apps/web/e2e/support/cassette.ts`, `apps/console/e2e/console.spec.ts`
- Flutter: `apps/mobile/lib/features/auth/sign_in_screen.dart`, `apps/mobile/lib/core/session.dart`, the
  `testSignIn*` keys in `apps/mobile/lib/l10n/app_en.arb` / `app_fa.arb` (regenerate localizations),
  `apps/mobile/test/sign_in_widget_test.dart`
- `.env.example`: `TEST_SIGN_IN=off` (or remove the line with the feature)

**G8. Tests to add (contract and invariants first, ch. 35.2).**
- `FakeAdapter` throws for `APP_ENV=staging` and `production`; constructs for `local`.
- `SuppliersService.searchable()` never returns `fake` when `APP_ENV=staging`.
- Duffel `call()` with a `duffel_test_` token and `environment: "production"` fails with `SUPPLIER_AUTH`.
- Seed with `APP_ENV=staging` inserts no `fake` row and no demo users.
- Web e2e: a search with zero searchable providers shows `results.noSources` and the "Ask our team" action, and no
  `truth.FAKE` tag.

### 2.4 Turning live flights on (operations, no code)

1. Duffel account in live mode (Duffel's go-live verification; INFERRED, check their dashboard). Confirm with Duffel
   in writing that serving customers located in Iran is allowed under their terms (counsel question, UNKNOWN).
2. Developer Panel › Providers › Duffel › Credentials: enter the **live** access token (step-up required).
3. "Test connection" must show OK; then enable the provider. Point of sale GB, currency GBP (seed defaults).
4. Watch Developer Panel › Providers health (circuit, p95, daily budget 3000 calls, look-to-book alert).
5. Amadeus Enterprise stays BLOCKED until the contract, office ID and WSDL exist (STAGE-0).

Compliance policies still apply to live results: Iranian carriers stay BLOCK (D-01), segments touching Iranian
airports go to REVIEW. Live data does not change the truth model: offers are revalidated before a quote, baggage that
the supplier does not state stays UNKNOWN.

### 2.5 Done when

Deployed hosts show no FAKE, sandbox or test sign-in anywhere; a live Duffel search on staging returns real carriers or
the `NO_SOURCES` notice; all suites green locally (`APP_ENV=local`); STAGE-14 records OBSERVED results.

---

## 3. Phase H: content pages (FAQ, travel rules, flight-buying guide)

### 3.1 Where the content lives

- New files `packages/i18n/src/content/faq.ts`, `travel-rules.ts`, `flight-guide.ts`, each exporting
  `{ en: Item[], fa: Item[] }` with the same `id`s; export them from `packages/i18n/src/index.ts`.
  Long-form text stays out of `en.ts` / `fa.ts` (those hold UI strings), following the `terms` page pattern but shared.
- Spec test `packages/i18n/src/content.spec.ts`: same ids and count in en and fa; no empty strings.
- Pages (web):
  - `apps/web/src/app/[locale]/faq/page.tsx`: accordion with native `<details>` (keyboard and screen-reader friendly),
    plus `FAQPage` JSON-LD for search engines.
  - `apps/web/src/app/[locale]/travel-rules/page.tsx`: six sections, each a heading and bullet list.
  - `apps/web/src/app/[locale]/flights/guide/page.tsx`: the buying guide, sections as anchors.
  - Home (`apps/web/src/app/[locale]/page.tsx`): a "Frequently asked questions" band with the five questions and a
    link to `/faq`.
  - Footer "Help" column (`apps/web/src/components/shell.tsx`, `Footer`): add FAQ, Travel rules, Buying guide.
- New UI keys in `packages/i18n/src/en.ts` and `fa.ts`: `nav.faq`, `nav.travelRules`, `nav.flightGuide`,
  `home.faqTitle`, `home.faqAll`, `content.generalNotice`.
- Flutter: Account › Help opens the same web pages (`/fa/faq`, `/fa/travel-rules`, `/fa/flights/guide`) in the
  in-app browser, like the payment page (Phase C decision 8); new arb keys for the three menu labels.
- Each page ends with `content.generalNotice`: fa «این راهنما عمومی است؛ قوانین ایرلاین، فرودگاه و کشور مقصد ملاک
  نهایی است.» / en "This is general guidance; the airline's, airport's and destination country's rules always apply."

### 3.2 FAQ (سوالات متداول)

Text below is final copy except where an owner decision is marked.

**fa-1. چگونه در یونی‌تراول بلیت هواپیما بخریم؟**
یونی‌تراول بلیت پروازهای خارجی را، به‌ویژه از ایران و فرودگاه‌های نزدیک مرز مانند وان، ارزروم و ایروان به
بریتانیا و اروپا، هماهنگ می‌کند:
۱. مبدأ، مقصد، تاریخ و تعداد مسافران را جست‌وجو کنید. نتایج به‌صورت زنده از سیستم‌های ایرلاین‌ها و آژانس‌ها
دریافت می‌شود.
۲. مسیر دلخواه را انتخاب کنید و درخواست بدهید؛ اگر مسیر مناسبی ندیدید، از تیم ما بخواهید برایتان پیدا کند. ثبت
درخواست رایگان است و به معنای رزرو نیست.
۳. کارشناس ما با شمارهٔ تأییدشدهٔ شما تماس می‌گیرد، نرخ، بار مجاز و شرایط ورود را بررسی می‌کند و پیشنهاد قیمت
رسمی برایتان می‌فرستد.
۴. پس از پذیرش پیشنهاد و تأیید مدارک مسافران، پرداخت در روز صدور بلیت انجام می‌شود و بلیت در بخش «درخواست‌های
من» قرار می‌گیرد.
پروازهای داخلی ایران در حال حاضر ارائه نمی‌شوند. *(O1)*

**en-1. How do I buy a flight ticket with Uni Travel?**
Uni Travel arranges international flights, especially from Iran and nearby border airports such as Van, Erzurum and
Yerevan to the UK and Europe:
1. Search by origin, destination, date and travellers. Results come live from airline and agency systems.
2. Choose an itinerary and send a request, or ask our team to find options. Requesting is free and is not a booking.
3. Our team calls your verified number, checks the fare, baggage and entry rules, and sends you a formal quote.
4. Once you accept the quote and your travellers' documents are verified, you pay on the day the ticket is issued,
and the ticket appears under "My requests".
Domestic flights within Iran are not offered at present. *(O1)*

**fa-2. آیا امکان خرید اقساطی بلیت هواپیما وجود دارد؟**
در حال حاضر خیر. هزینهٔ بلیت به‌طور کامل و در زمان صدور بلیت پرداخت می‌شود و پیش‌پرداخت یا پرداخت مرحله‌ای
دریافت نمی‌کنیم؛ به همین دلیل تا زمانی که بلیت شما صادر نشده، پولی از شما گرفته نمی‌شود. هر تغییری در روش‌های
پرداخت در همین صفحه اعلام خواهد شد. *(O2)*

**en-2. Can I pay for a flight in instalments?**
Not at present. The full fare is paid when the ticket is issued; we do not take deposits or staged payments, so no
money is taken from you until your ticket exists. Any change to payment options will be announced on this page. *(O2)*

**fa-3. برای خرید بلیت هواپیما چه مدارکی لازم است؟**
- گذرنامهٔ معتبر برای هر مسافر، از جمله کودکان و نوزادان. بسیاری از کشورها اعتبار گذرنامه را برای مدتی پس از
  پایان سفر لازم می‌دانند؛ قوانین کشور مقصد و کشورهای ترانزیت را بررسی کنید.
- ویزا یا مجوز ورود کشور مقصد و در صورت نیاز مدارک ورود به کشور ترانزیت، مثلاً هنگام شروع سفر از وان، ارزروم
  یا ایروان.
- مشخصات گذرنامه و تصویر صفحهٔ مشخصات آن، که در حساب کاربری خود ثبت می‌کنید؛ تیم ما پیش از صدور بلیت آن را
  تأیید می‌کند.
- شمارهٔ تلفن تأییدشده برای تماس دربارهٔ درخواست.
- برای کودکانی که بدون یکی از والدین یا بدون همراه سفر می‌کنند، مدارکی که ایرلاین یا کشور مقصد درخواست می‌کند.

**en-3. What documents do I need to buy a ticket?**
- A valid passport for every traveller, including children and infants. Many countries require the passport to stay
  valid for some time after your trip; check the rules of your destination and any transit country.
- A visa or entry permission for the destination, and entry documents for a transit country where needed, for
  example when starting from Van, Erzurum or Yerevan.
- Passport details and a photo of the passport's data page, added in your account; our team verifies them before
  the ticket is issued.
- A verified phone number so we can contact you about the request.
- For children travelling without one or both parents, or unaccompanied, the documents the airline or destination asks for.

**fa-4. چرا هنگام خرید، قیمت بلیت ناگهان تغییر می‌کند یا دو گزینهٔ متفاوت قیمت مشابهی دارند؟**
نرخ بلیت را ایرلاین تعیین می‌کند و تا لحظهٔ صدور بلیت ممکن است تغییر کند: با فروش هر صندلی، کلاس نرخی
ارزان‌تر تمام می‌شود و نرخ بعدی جای آن را می‌گیرد. به همین دلیل:
- پیش از فرستادن پیشنهاد قیمت، نرخ را دوباره با سیستم ایرلاین بررسی می‌کنیم.
- هر پیشنهاد قیمت مهلت اعتبار دارد. اگر پیش از صدور بلیت نرخ تغییر کند، پیش از دریافت هر پولی به شما خبر
  می‌دهیم و پیشنهاد تازه می‌فرستیم.
- دو گزینه با قیمت نزدیک ممکن است در بار مجاز، امکان استرداد و تغییر، مدت توقف، یکپارچه یا جداگانه بودن بلیت
  و ایرلاین با هم فرق داشته باشند. این جزئیات در پیشنهاد قیمت آمده است؛ پیش از پذیرش آن‌ها را مقایسه کنید.

**en-4. Why does the price change during booking, or why do two different options cost about the same?**
Airlines set fares, and a fare can change until the ticket is issued: as seats sell, a cheaper fare class runs out and
the next one replaces it. That is why:
- We re-check the fare with the airline's system before sending you a quote.
- Every quote has an expiry. If the fare changes before ticketing, we tell you before taking any money and send a new quote.
- Two options at a similar price can differ in baggage, refund and change rules, layover length, single or separate
  tickets, and airline. Your quote lists these details; compare them before accepting.

**fa-5. میزان بار مجاز پرواز چقدر است؟**
بار مجاز ثابت نیست و به ایرلاین، مسیر، کلاس پرواز و نوع نرخ بستگی دارد. بار مجاز هر پرواز در جزئیات پیشنهاد
قیمت و روی بلیت شما نوشته می‌شود. اگر ایرلاین اطلاعات بار را اعلام نکرده باشد، آن را «نامشخص» نشان می‌دهیم و تا
روشن شدن آن پیشنهاد قیمت نمی‌فرستیم. در سفر با بلیت‌های جداگانه، بار مجاز هر بلیت جداست و ممکن است لازم باشد
بار را در فرودگاه میانی تحویل بگیرید و دوباره تحویل دهید.

**en-5. How much baggage can I take?**
There is no single allowance: it depends on the airline, route, cabin and fare. Each flight's allowance is shown in
your quote and on your ticket. If the airline has not stated it, we show it as "unknown" and do not send a quote until
it is confirmed. On separate tickets, each ticket has its own allowance, and you may need to collect and re-check your
bags at the connecting airport.

### 3.3 Travel rules page (قوانین و نکات مهم پروازها)

Page title fa «قوانین و نکات مهم پروازهای خارجی» *(O1: "داخلی و" dropped while domestic flights are not offered)*,
en "Important rules and tips for international flights".

**۱. حضور در فرودگاه و پذیرش مسافر**
- زمان حضور در فرودگاه را طبق اعلام ایرلاین رعایت کنید؛ این زمان روی بلیت یا در پیام ایرلاین آمده است.
- زمان پذیرش (Check-in) و بسته شدن گیت پرواز خود را از قبل بررسی کنید.
- در ایام شلوغ و تعطیلات زودتر به فرودگاه بروید.

**1. Arriving at the airport and check-in**
- Arrive at the time your airline states; it is on your ticket or in the airline's message.
- Check your flight's check-in and gate-closing times in advance.
- At busy times and holidays, go to the airport earlier.

**۲. مدارک شناسایی و اعتبار آن‌ها**
- همراه داشتن مدارک شناسایی معتبر برای همهٔ مسافران الزامی است.
- گذرنامه باید اعتبار کافی داشته باشد.
- شرایط ویزا و مدارک ورود به کشور مقصد و کشورهای ترانزیت را پیش از سفر بررسی کنید.

**2. Identity documents and their validity**
- Every traveller must carry valid identity documents.
- Your passport must have enough remaining validity.
- Check visa and entry requirements for your destination and any transit country before you travel.

**۳. قوانین بار و چمدان**
- بار مجاز هر پرواز متفاوت است و باید پیش از سفر بررسی شود.
- حمل برخی کالاها در بار تحویلی یا کیف دستی ممنوع است.
- هزینهٔ اضافه‌بار طبق قوانین ایرلاین دریافت می‌شود.

**3. Baggage rules**
- Allowances differ by flight; check yours before you travel.
- Some items are banned from checked or cabin baggage.
- Excess baggage is charged under the airline's rules.

**۴. مسافران با شرایط خاص**
- مسافران سالمند، کودکان بدون همراه، افراد با شرایط پزشکی خاص و مسافرانی که به خدمات ویژه نیاز دارند باید پیش
  از پرواز اطلاع دهند.
- بهتر است درخواست خدمات ویژه هنگام ثبت درخواست بلیت ثبت شود.

**4. Passengers with special needs**
- Older travellers, unaccompanied children, people with medical conditions and anyone needing special assistance
  should tell us before the flight.
- It is best to ask for special services when you send your ticket request.

(Links to the existing SSR choices on the request form: wheelchair, meals, unaccompanied minor.)

**۵. تغییرات، تأخیر و لغو پرواز**
- زمان پرواز ممکن است به دلایل مختلف تغییر کند.
- در صورت تأخیر یا لغو پرواز، قوانین ایرلاین مربوطه اعمال می‌شود.
- پیش از حرکت به فرودگاه، وضعیت پرواز خود را بررسی کنید.

**5. Changes, delays and cancellations**
- Flight times can change for many reasons.
- If a flight is delayed or cancelled, the operating airline's rules apply.
- Check your flight status before leaving for the airport.

**۶. نکات ایمنی و عمومی در هواپیما**
- از دستورهای خدمهٔ پرواز پیروی کنید و هنگام روشن بودن علامت، کمربند ایمنی را ببندید.
- پاوربانک و باتری لیتیومی یدکی را فقط در کیف دستی بگذارید، نه در بار تحویلی.
- حمل مایعات در کیف دستی محدودیت دارد؛ مقررات فرودگاه مبدأ و ترانزیت را بررسی کنید.
- داروهای ضروری و مدارک سفر را در کیف دستی نگه دارید.
- استعمال دخانیات و سیگار الکترونیکی در هواپیما ممنوع است.
- بار یا بستهٔ افراد ناشناس را هرگز حمل نکنید.

**6. Safety and general tips on board**
- Follow the crew's instructions and keep your seat belt fastened while the sign is on.
- Carry power banks and spare lithium batteries in cabin baggage only, never in checked bags.
- Liquids in cabin baggage are limited; check the rules of your departure and transit airports.
- Keep essential medicines and travel documents in your cabin bag.
- Smoking and e-cigarettes are not allowed on board.
- Never carry bags or parcels for people you do not know.

### 3.4 Flight-buying guide (خرید بلیت هواپیما در یونی‌تراول ✈️)

Route `/[locale]/flights/guide`. Owner's twelve headings with final copy; reworded headings are marked.

| # | fa heading | en heading | Body (fa / en) |
|---|---|---|---|
| 1 | راهنمای کامل خرید بلیت هواپیما از یونی‌تراول | Complete guide to buying a ticket with Uni Travel | Reuses FAQ 1 steps (rendered from the same content item). |
| 2 | مزایای خرید بلیت هواپیما از یونی‌تراول | Why book with Uni Travel | fa: نتایج زنده از سیستم ایرلاین‌ها، یک کارشناس برای هر درخواست، پرداخت فقط هنگام صدور بلیت، پشتیبانی به فارسی و انگلیسی. / en: Live results from airline systems, a person on every request, payment only at ticketing, support in Persian and English. |
| 3 | ~~امکان خرید اقساطی~~ → **پرداخت فقط هنگام صدور بلیت** *(O2)* | Pay only when your ticket is issued | fa: تا زمانی که بلیت صادر نشده، پولی از شما گرفته نمی‌شود. / en: No money is taken until your ticket is issued. |
| 4 | ~~داخلی و خارجی با بهترین قیمت~~ → **پروازهای خارجی با نرخ‌های بررسی‌شده** *(O1, O4)* | International flights at checked fares | fa: پیش از هر پیشنهاد، نرخ را دوباره با ایرلاین بررسی می‌کنیم. / en: We re-check every fare with the airline before quoting. |
| 5 | ~~پرداخت اعتباری~~ → **روش‌های پرداخت روشن** *(O3)* | Clear payment options | fa: روش‌های پرداخت در پیشنهاد قیمت و فاکتور شما اعلام می‌شود. / en: Payment options are stated on your quote and invoice. (Add "card payment online" only when `payments.online.enabled` is on.) |
| 6 | ~~استرداد آنلاین~~ → **ثبت آنلاین درخواست استرداد و تغییر** *(O5)* | Request refunds and changes online | fa: درخواست استرداد یا تغییر را از صفحهٔ درخواست ثبت کنید؛ تیم ما طبق قوانین نرخ پیگیری می‌کند. / en: Send a refund or change request from your request page; our team handles it under the fare rules. |
| 7 | دریافت خدمات ویزا همزمان با خرید بلیت پرواز خارجی | Visa services alongside your international ticket | Shown only when `services.visa.enabled` is on *(O6)*; links to `/visa`. |
| 8 | ~~اطلاع‌رسانی تغییرات قیمت~~ → **اطلاع‌رسانی تغییر نرخ پیش از صدور** *(O4)* | We tell you if a quoted fare changes | fa: اگر نرخ پیشنهادشده پیش از صدور تغییر کند، پیش از هر پرداختی خبرتان می‌کنیم. / en: If a quoted fare changes before ticketing, we tell you before any payment. |
| 9 | امکان رزرو همزمان پرواز و بیمهٔ مسافرتی | Flight and travel insurance together | Shown only when `services.insurance.enabled` is on *(O7)*. |
| 10 | پشتیبانی ۲۴ ساعته حتی در روزهای تعطیل | 24-hour support, including holidays | Shown only after the client confirms hours *(O15)*; otherwise heading «پشتیبانی به فارسی و انگلیسی» with hours from settings. |
| 11 | رزرو انواع بلیت هواپیما برای مقاصد ~~داخلی و~~ خارجی *(O1)* | Flights to destinations across the UK and Europe | fa: مسیرهای مستقیم و چندمرحله‌ای، از جمله شروع سفر از وان، ارزروم و ایروان. / en: Direct and connecting routes, including starts from Van, Erzurum and Yerevan. |
| 12 | راهنمای انتخاب بهترین زمان برای خرید بلیت | When to buy your ticket | fa: برای ایام تعطیلات و فصل شلوغ زودتر اقدام کنید، با گزینهٔ «± ۳ روز» تاریخ‌های نزدیک را مقایسه کنید و زمان کافی برای ویزا و مدارک در نظر بگیرید. / en: Book early for holidays and peak season, compare nearby dates with the "± 3 days" option, and leave time for visas and documents. |

### 3.5 Done when

Pages render in en and fa (RTL) with axe clean; the content spec test passes; JSON-LD validates; Playwright visual
baselines added; Flutter opens the pages; STAGE-15 written.

---

## 4. Phase I: new menu and services

### 4.1 Menu (منوی سایت یونی‌تراول)

The menu is built from a new public endpoint, so items appear only when their flag is on:
`GET /v1/site` (public, cached 60 s): `{ menu: Record<MenuKey, boolean>, support: { phone, email, hours: { en, fa } }, payments: { online: boolean } }`.
New flags in `packages/contracts/src/config.ts` (`FEATURE_FLAGS`, `DEFAULT_FLAGS`) with owner, `removeBy` and
description in `FLAG_META` (`packages/db/src/seed/index.ts`): `hotels.enabled`, `stays.enabled`, `trains.enabled`, `buses.enabled`, `services.visa.enabled`,
`services.tours.enabled`, `services.cip.enabled`, `services.insurance.enabled`, `loyalty.enabled`, all default
**false**. Flights and cargo use the existing `cargo.enabled`; flights are always on.

| # | Item (fa) | Behaviour (owner) | Route | Flag | Built in this phase |
|---|---|---|---|---|---|
| 1 | ✈️ پرواز | Listed (live search) | `/` and `/flights` | always | Exists; live per Phase G |
| 2 | 🏨 هتل | Listed | `/hotels` | `hotels.enabled` | Port + pages; hidden until a provider is contracted *(O8)* |
| 3 | 🚆 قطار | Listed | `/trains` | `trains.enabled` | Port + pages; hidden *(O8)* |
| 4 | 🚌 اتوبوس | Listed | `/buses` | `buses.enabled` | Port + pages; hidden *(O8)* |
| 5 | 🏡 ویلا و اقامتگاه | Listed | `/stays` | `stays.enabled` | Port + pages; hidden *(O8)* |
| 6 | 🛂 ویزا | Make an order | `/visa` | `services.visa.enabled` | Service request VISA *(O6)* |
| 7 | 🌍 تورهای مسافرتی | Make a call | `/tours` | `services.tours.enabled` | Service request TOUR_CALLBACK *(O10)* |
| 8 | 🛋️ خدمات CIP فرودگاهی | IKA (Tehran Imam Khomeini) only | `/cip` | `services.cip.enabled` | Service request CIP *(O9)* |
| 9 | 📦 ارسال بار و کارگو | Existing | `/cargo` | `cargo.enabled` | Exists |
| 10 | 🛡️ بیمهٔ مسافرتی | Request | `/insurance` | `services.insurance.enabled` | Service request INSURANCE *(O7)* |
| 11 | 💳 سفر کارت | Future | none | none | **Not built** *(O14)* |
| 12 | ⭐ باشگاه مشتریان | Admin adds customers, gives discounts and bonuses | `/club` | `loyalty.enabled` | Club (4.4) |
| 13 | 📋 پیگیری خرید | Track purchases | `/track` | always | Unified tracking (4.5) |
| 14 | 💬 پشتیبانی | Email and phone | `/support` | always | Support page (4.6) |

Layout (`apps/web/src/components/shell.tsx`): the desktop bar has room for about six items, so:
- Bar: enabled booking verticals (Flights, Hotels, Trains, Buses, Stays), then a "خدمات / Services" disclosure menu
  (Visa, Tours, CIP, Cargo, Insurance), then Track. Support and Club go to the header utility area and the footer.
- Mobile menu: three groups with headings (Book, Services, Help) listing every enabled item with its icon.
- Use the existing lucide icons (Plane, BedDouble, TrainFront, Bus, House, Stamp, Globe, Armchair, Package,
  ShieldCheck, Star, ClipboardList, LifeBuoy) rather than emoji in the UI; emoji stay out of the markup for screen readers.
- New keys `nav.flights`, `nav.hotels`, `nav.trains`, `nav.buses`, `nav.stays`, `nav.visa`, `nav.tours`, `nav.cip`,
  `nav.insurance`, `nav.club`, `nav.track`, `nav.support`, `nav.services` in en and fa (fa labels exactly as the
  owner wrote them, with «بلیت» spelling and «بیمهٔ مسافرتی»).
- Flutter: the same groups in the app drawer/More tab, driven by `GET /v1/site`.

### 4.2 Service requests (visa, tours, CIP, insurance; later hotel/stay/train/bus requests)

v1 stays request-based (D-02). One generic request type instead of four modules:

- **ADR-0015**: deviation from D-04 (adds non-flight products); generic `service_requests`; verticals behind flags.
- **Migration 0010** `service_requests`: `id`, `ref` (same generator as flight refs), `type`
  (`VISA | TOUR_CALLBACK | CIP | INSURANCE | HOTEL | STAY | TRAIN | BUS`), `status`, `customerUserId`,
  `contactIdentityId`, `contactPhoneSnapshot`, `details` jsonb (validated per type), `submittedVia`,
  `submittedLocale`, `assigneeUserId`, `slaDueAt`, `version`, timestamps; indexes as `flight_requests`
  (queue, customer, assignee). Status history and messages reuse the request tables' pattern
  (`service_request_status_history`, `service_request_messages`).
- **Contracts** `packages/contracts/src/services.ts` (Zod), `details` per type:
  - VISA: `destinationCountry` (ISO-2), `purpose` (TOURISM, BUSINESS, STUDY, FAMILY, TRANSIT), `travellerIds`,
    `intendedTravelDate`, `linkedFlightRequestRef?`, `note?`
  - TOUR_CALLBACK: `destination` (text), `approxDates` (text), `travellersCount`, `bestTimeToCall`, `note?`
  - CIP: `airport` fixed `"IKA"`, `direction` (ARRIVAL, DEPARTURE), `flightNumber`, `date`, `passengersCount`, `note?`
  - INSURANCE: `destinationRegion`, `startDate`, `endDate`, `travellerIds`, `note?`
  - HOTEL/STAY/TRAIN/BUS: `offerSnapshotId` once listings exist, else the manual fields of the search form
- **State machine** `packages/domain/src/service-request.ts` (property tests like the flight machine):
  `SUBMITTED → IN_PROGRESS → QUOTED → CONFIRMED → COMPLETED`; `CANCELLED` from any non-terminal state (customer only
  before CONFIRMED); `CLOSED_NO_RESPONSE` from IN_PROGRESS/QUOTED after the workflow timeout. TOUR_CALLBACK may go
  `IN_PROGRESS → COMPLETED` directly (a call, no quote).
- **Compliance**: party screening on submit, as for flights; new policy type `SERVICE` with keys like
  `INSURANCE:IR`, `CIP:IKA` seeded `REVIEW` (data, not code), so a REVIEW holds the request for the compliance officer.
- **Permissions** (`packages/contracts/src/permissions.ts`, migration grants as in 0003/0004):
  `service_request.read.any`, `service_request.write` (admin, owner). Customers act on their own requests through
  ownership checks (404 on mismatch).
- **API** (`apps/api/src/modules/services/`):
  `POST /v1/service-requests`, `GET /v1/service-requests`, `GET /v1/service-requests/:ref`,
  `POST /v1/service-requests/:ref/cancel`, `POST /v1/service-requests/:ref/messages`;
  admin `GET /v1/admin/service-requests`, `GET /v1/admin/service-requests/:ref`,
  `POST /v1/admin/service-requests/:ref/transition`. Feature flag off → `FEATURE_DISABLED` (as cargo does).
- **Quotes and invoices**: extend the commercial-document subject (ADR-0006) to `SERVICE_REQUEST` so staff send
  numbered quotations and invoices the same way; PAY_ON_TICKETING applies only to flight tickets (counsel to confirm
  payment timing for visa/insurance fees, UNKNOWN).
- **Notifications**: templates `service_request.submitted`, `.quoted`, `.confirmed`, `.cancelled` in en/fa for
  inbox, email, SMS (seed `notificationTemplates`).
- **Web**: `/visa`, `/tours`, `/cip`, `/insurance` forms (React Hook Form + Zod, travellers picker reused), listing
  under "My requests". **Console**: `admin/(app)/services` list and detail in the Clear deck kit (queue, assign,
  transition, messages, quote).

### 4.3 Hotels, stays, trains, buses: live listing ports

- Ports in `apps/api/src/modules/stays/adapter.ts` (`AccommodationSupplierAdapter`: `search`, `price`, `healthCheck`)
  and `apps/api/src/modules/ground/adapter.ts` (`GroundSupplierAdapter`), modelled on `FlightSupplierAdapter`, behind
  the same gateway (deadlines, circuit breaker, budgets, call records). Migration adds `vertical`
  (`FLIGHT | STAY | RAIL | BUS`) to `providers`.
- Normalised models in `packages/contracts/src/stays.ts` and `ground.ts`; customer projections follow ADR-0004 *(O8b)*.
- **No adapter is implemented** until the owner names a contracted provider; the provider, its API terms and whether
  it may serve customers in Iran are UNKNOWN. The `ProviderId` enum gains an id only together with its adapter.
- Pages `/hotels`, `/stays`, `/trains`, `/buses` reuse the search shell; with no enabled provider the flag stays off
  and the item is not in the menu. Selecting a listing creates a HOTEL/STAY/TRAIN/BUS service request with an
  immutable snapshot, exactly like flights.

### 4.4 Customer club (باشگاه مشتریان), ADR-0016

- **Migration 0011**:
  - `loyalty_tiers` (`id`, `code`, `nameEn`, `nameFa`, `active`)
  - `loyalty_members` (`userId` PK, `tierId`, `status` ACTIVE/SUSPENDED/REMOVED, `joinedAt`, `addedBy`, `note`)
  - `loyalty_benefits` (`id`, `kind` DISCOUNT_PERCENT/DISCOUNT_FIXED/BONUS_CREDIT/PERK, `value`, `currency?`,
    `appliesTo` FLIGHT/CARGO/SERVICE/ANY, `tierId?` or `userId?`, `validFrom`, `validTo`, `status`,
    `createdBy`, `approvedBy?`)
  - `loyalty_ledger`, insert-only like audit (bonus credit granted, used, expired; `amountMinor`, `currency`,
    `reason`, `actorUserId`, `invoiceId?`)
- **Permissions**: `loyalty.read`, `loyalty.manage` (privileged), `loyalty.benefit.approve` (four-eyes for benefits
  above the existing refund threshold). Every change audited.
- **Rules**: staff apply a benefit when building a quotation, as its own line («تخفیف باشگاه مشتریان» /
  "Customer club discount"); supplier prices are never altered; invoices stay frozen after issue; bonus credit has no
  cash value and is used only by staff on an invoice. VAT treatment of discounts UNKNOWN (accountant, O12).
- **Console** `admin/(app)/club`: members (add from Customers, tier, suspend, remove), benefits (create, approve,
  expire), ledger. The quote builder shows the customer's active benefits to holders of `pricing.write`.
- **Customer** `/club`: membership tier, active benefits and credit balance; non-members see a short explanation.
  Adding someone sends an inbox/email notice. Marketing consent stays separate.

### 4.5 Purchase tracking (پیگیری خرید)

- `/track` signed in: one list of flight requests, cargo requests, service requests and invoices, with status chips and
  filters, linking to the existing detail pages.
- Signed out: reference + phone number. `POST /v1/track/lookup` always answers 202 (no enumeration) and sends an OTP to
  the phone on record only when both match; `POST /v1/track/verify` returns the status timeline only (no names,
  passport data or prices). Rate-limited and PoW-protected like OTP sign-in.

### 4.6 Support (پشتیبانی)

- `/support`: phone (`tel:` link, `dir="ltr"`), email (`mailto:`), hours, link to FAQ, and for signed-in customers
  "Message our team" on a request.
- Values from `settings.app.company.phone`, `company.email`, plus new `support.hours { en, fa }` in `AppSettings`
  (`packages/contracts/src/config.ts`, `DEFAULT_SETTINGS`). Replace the placeholders in Developer Panel › Settings
  before launch *(O13)*.

### 4.7 Done when

Menu renders from `GET /v1/site` in en/fa and Flutter; every new route has a declared permission and passes the
fail-closed route test and permission matrix; state-machine property tests green; serialiser property test covers the
new customer views; OpenAPI regenerated; STAGE-16 written.

---

## 5. Order of work and plan entries

1. ADR-0014 → Phase G (code, tests, VPS `.env`, one-off SQL) → STAGE-14. **Do this first: it is what makes flight
   data live.**
2. Phase H content → STAGE-15 (independent of owner decisions except the marked wording).
3. ADR-0015, ADR-0016 → Phase I → STAGE-16.

Append to `docs/PLAN.md` under a new heading:

```
## Content, menu and live data (27 Oct 2026) — status
Spec and owner decisions: `docs/CONTENT-MENU-LIVE-DATA.md`.
- [ ] Phase G — live data only on deployed hosts (STAGE-14)
- [ ] Phase H — FAQ, travel rules, flight-buying guide (STAGE-15)
- [ ] Phase I — menu, service requests, tracking, support, customer club, vertical ports (STAGE-16)
```

Instruction to give the implementing session: "Read `docs/CONTENT-MENU-LIVE-DATA.md` and implement Phase G, then H,
then I. Write the ADRs first, keep proposed defaults where owner decisions are open, and record each phase in
`docs/stages/`."
