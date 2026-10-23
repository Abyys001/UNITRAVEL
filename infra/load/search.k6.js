// Load test (booklet ch. 32.1 "Performance", SLOs ch. 30.5): search fan-out and the read paths around it.
// Local:   docker run --rm -i --network host -e API=http://localhost:4100 grafana/k6:1.3.0 run - < infra/load/search.k6.js
// Staging: set API and RATE (searches/s); each virtual user appears as its own address behind the proxy.
import http from "k6/http"
import { check, sleep } from "k6"
import { Trend, Rate } from "k6/metrics"

const API = __ENV.API || "http://localhost:4100"
const RATE = Number(__ENV.RATE || 1)
const PER = __ENV.PER || "2s"
const DURATION = __ENV.DURATION || "60s"

const firstResults = new Trend("search_first_results_ms", true)
const complete = new Trend("search_complete_ms", true)
const withResults = new Rate("search_with_results")

export const options = {
  scenarios: {
    searches: { executor: "constant-arrival-rate", rate: RATE, timeUnit: PER, duration: DURATION, preAllocatedVUs: 20, maxVUs: 200, exec: "search" },
    browse: { executor: "constant-vus", vus: 10, duration: DURATION, exec: "browse" },
  },
  thresholds: {
    // SLO: first results within 8 s for 95% of searches; start returns 202 well under 300 ms.
    search_first_results_ms: ["p(95)<8000"],
    "http_req_duration{name:start}": ["p(95)<300"],
    "http_req_duration{name:locations}": ["p(95)<200"],
    http_req_failed: ["rate<0.01"],
    search_with_results: ["rate>0.95"],
  },
}

// The four ops benchmarks (ch. 32.4) plus two common variants; all have coverage in the FAKE network.
const ROUTES = [["THR", "LON"], ["TBZ", "MAN"], ["MHD", "FRA"], ["EVN", "LON"], ["TBZ", "LON"], ["THR", "IST"]]
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${1 + ((Math.random() * 250) | 0)}`
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

export function search() {
  const [from, to] = ROUTES[(Math.random() * ROUTES.length) | 0]
  const headers = { "content-type": "application/json", "x-forwarded-for": ip(), "x-device-id": `k6-${__VU}-${__ITER}-${Date.now()}` }
  const body = JSON.stringify({ tripType: "ONE_WAY", slices: [{ from: { city: from }, to: { city: to }, date: day(20 + ((Math.random() * 60) | 0)) }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" })
  const t0 = Date.now()
  const r = http.post(`${API}/v1/flight-searches`, body, { headers, tags: { name: "start" } })
  if (!check(r, { "search accepted": (x) => x.status === 202 })) return
  const id = r.json("id")
  let first = 0
  for (let i = 0; i < 60; i++) {
    const s = http.get(`${API}/v1/flight-searches/${id}`, { headers, tags: { name: "poll" } })
    if (s.status !== 200) break
    const st = s.json()
    if (!first && st.results && st.results.length) { first = Date.now() - t0; firstResults.add(first) }
    if (st.status === "COMPLETE" || st.status === "PARTIAL" || st.status === "FAILED") { complete.add(Date.now() - t0); break }
    sleep(0.5)
  }
  withResults.add(first > 0)
}

export function browse() {
  const q = ["teh", "lon", "tab", "ist", "van", "مشه"][(Math.random() * 6) | 0]
  const headers = { "x-forwarded-for": ip() }
  check(http.get(`${API}/v1/locations?q=${encodeURIComponent(q)}`, { headers, tags: { name: "locations" } }), { "locations 200": (x) => x.status === 200 })
  check(http.get(`${API}/health`, { headers, tags: { name: "health" } }), { "health 200": (x) => x.status === 200 })
  sleep(1)
}
