# New content: classification workflow

Use this for every document, text or FAQ the client sends. System: ADR-0017. Rules: `CLAUDE.md` rules 2, 3, 5, 7. Owner decisions O1 to O15: `docs/CONTENT-MENU-LIVE-DATA.md`.

## The 12 steps (brief §23.8)

1. **Extract.** Save text and structure (headings, tables, lists). Note the file name, date and who sent it. Do not paraphrase yet.
2. **Subject and audience.** One line each: what is it about, who reads it (visitor, buyer, signed-in customer, staff).
3. **Claims.** Underline every promise, number, price, time, "24/7", "cheapest", "instant", "free", legal or policy statement. Each one goes into `claimsToVerify`, with the reason. Compare with `docs/content/CLAIMS-TO-VERIFY.md` and the owner decisions.
4. **Classify** with the table below. One item can have several destinations.
5. **Destinations.** For each: page, component and section. Prefer one entry shown in several places (related-services link, snippet) over copies.
6. **Related content.** Search existing entries and the glossary for the same topic.
7. **Duplicates and contradictions.** If another entry says something different (instalments, hours, baggage figures), stop and ask the owner which is right. Never publish both.
8. **Recommendation.** Write the placement list: homepage section, service page, blog or guide, FAQ, legal page, signed-in area, glossary, several of these.
9. **SEO.** slug (ascii, kebab), title up to 70 characters, description up to 170, category, tags, related services, internal links.
10. **Images.** Only licensed or owned images. Add alt text. Record the source in `apps/web/public/media/CREDITS.md`.
11. **Review.** Anything with an open claim stays IN_REVIEW. Legal, financial, visa, insurance, medical and baggage figures need the named owner (counsel for legal; client for hours and contacts).
12. **Publish.** Only a user with `cms.publish` (owner) publishes, and only when `claimsToVerify` is empty (a database check enforces it). Record who approved in the revision note.

AI help is optional. An AI may draft steps 2 to 9, but it never sets a status and never publishes.

## Placement rules (brief §23.1 to §23.7)

| Content is | Goes to | Notes |
|---|---|---|
| a major benefit, differentiator, top service, short decision help | **landing section** | short; only a verified benefit shows as active |
| a service with its own form, steps, eligibility, quotation, status | **service page** | text comes from a guide entry; operations stay in the service module |
| educational, destination or search-driven | **blog (ARTICLE) or guide (GUIDE)** | link to the service page; do not put every article on the homepage |
| terms, privacy, refund and cancellation, service terms | **legal entry (LEGAL)** | counsel review; never mix travel advice into the privacy policy |
| a recurring specific question | **FAQ** | one source per question; no conflicting copies |
| a term and its meaning | **glossary** | structured: Persian, English, explanation, category, related |
| personal, transactional or per-customer | **signed-in area, never CMS** | bookings, shipments, loyalty balances, invoices, messages |
| live availability or prices | **provider integration, never CMS** | never typed into an article |
| not yet available | **Coming soon state** | service flag stays off (O6 to O10, O14) |

Combined placement example (instalments, only when really offered): a homepage benefit, a dedicated explanation article, a flight-page section, a hotel-page section if supported, an FAQ, and the conditions at checkout, all reading the same approved entry.

## Checklist for a new entry

- [ ] source file and date recorded
- [ ] claims listed, none invented
- [ ] kind, locale, slug, title, summary, SEO fields filled
- [ ] related services and internal links added
- [ ] no duplicate or contradiction with existing entries and FAQ
- [ ] images licensed, alt text written
- [ ] reviewer named; status IN_REVIEW until claims are cleared
- [ ] published by the owner; revision note written
- [ ] Persian and English both considered (English is added only when written and reviewed)
