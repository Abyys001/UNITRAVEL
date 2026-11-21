import { servicesEn } from "./guide/services.en"
import { flightsEn } from "./guide/flights.en"
import { cargoEn } from "./guide/cargo.en"
import { visaEn } from "./guide/visa.en"
import { cipEn } from "./guide/cip.en"

/**
 * Customer service pages and guided request flows (ADR-0041, STAGE-32).
 * Kept apart from en.ts so parallel sessions editing the main catalogue do not collide.
 */
export const flowEn = {
  services: servicesEn,
  flights: flightsEn,
  cargo: cargoEn,
  visa: visaEn,
  cip: cipEn,
  common: {
    back: "Back",
    next: "Continue",
    edit: "Edit",
    review: "Review",
    submit: "Send request",
    submitting: "Sending…",
    stepOf: "Step {n} of {total}",
    required: "Required",
    optional: "Optional",
    fixErrors: "Please check the highlighted fields.",
    draftRestored: "We restored the details you entered earlier.",
    selectPlaceholder: "Choose…",
    searchPlaceholder: "Type to search",
    noMatch: "Nothing matches your search.",
    pickDate: "Pick a date",
    clear: "Clear",
    invalid: "Please check this field.",
    progress: "Progress",
    steps: "Steps",
    stepDone: "{title} (done)",
    editSection: "Edit {section}",
    whatNext: "What happens next",
    reference: "Reference",
    year: "Year",
    month: "Month",
  },
} as const
