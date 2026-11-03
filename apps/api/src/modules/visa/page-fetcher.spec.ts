import { describe, expect, it } from "vitest"

import { quoteFound } from "@unitravel/domain"

import { htmlLinks, htmlToText, isGovernmentHost, robotsAllows } from "./page-fetcher"
import { slugify } from "./visa-research.service"

describe("htmlToText", () => {
  it("drops scripts and markup, keeps the words, decodes entities", () => {
    const t = htmlToText(`<html><script>var x = "visa-free"</script><p>You can visit&nbsp;without a <b>visa</b> for up to 90&#160;days.</p><li>Blank page</li></html>`)
    expect(t).not.toContain("var x")
    expect(t).toContain("You can visit without a visa for up to 90 days.")
    expect(t).toContain("- Blank page")
  })
  it("keeps quotes findable after extraction", () => {
    const html = `<p>Your passport must have an &lsquo;expiry date&rsquo; at least <strong>150 days</strong> after the date you arrive.</p>`
    expect(quoteFound("Your passport must have an 'expiry date' at least 150 days after the date you arrive", htmlToText(html))).toBe(true)
  })
})

describe("robots.txt", () => {
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/visa\n\nUser-agent: BadBot\nDisallow: /"
  it("applies the longest matching rule for *", () => {
    expect(robotsAllows(robots, "/visa/info", "UniTravelVisaResearch")).toBe(true)
    expect(robotsAllows(robots, "/private/x", "UniTravelVisaResearch")).toBe(false)
    expect(robotsAllows(robots, "/private/visa/x", "UniTravelVisaResearch")).toBe(true)
  })
  it("honours a group naming our agent", () => {
    expect(robotsAllows("User-agent: UniTravelVisaResearch\nDisallow: /\n\nUser-agent: *\nAllow: /", "/x", "UniTravelVisaResearch")).toBe(false)
  })
})

describe("official hosts", () => {
  it("recognises common government domain patterns and not GOV.UK or commercial sites", () => {
    expect(isGovernmentHost("www.evisa.gov.tr")).toBe(true)
    expect(isGovernmentHost("travel.state.gov")).toBe(true)
    expect(isGovernmentHost("www.diplomatie.gouv.fr")).toBe(true)
    expect(isGovernmentHost("www.gov.uk")).toBe(false)
    expect(isGovernmentHost("visa-agency.com")).toBe(false)
  })
  it("collects https links only", () => {
    expect(htmlLinks(`<a href="https://www.evisa.gov.tr/en/">e</a><a href="http://x.example">x</a><a href="/foo">f</a>`, "https://www.gov.uk/x")).toEqual(["https://www.evisa.gov.tr/en/", "https://www.gov.uk/foo"])
  })
})

describe("GOV.UK slugs", () => {
  it("slugifies English names the way GOV.UK does", () => {
    expect(slugify("United Arab Emirates")).toBe("united-arab-emirates")
    expect(slugify("Bosnia & Herzegovina")).toBe("bosnia-and-herzegovina")
    expect(slugify("Curaçao")).toBe("curacao")
  })
})
