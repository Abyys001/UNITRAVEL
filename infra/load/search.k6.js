// Load test (booklet ch. 32.1 "Performance", SLOs ch. 30.5): the customer flight catalog read path and the read paths around it.
// ADR-0034: customers read stored snapshots (GET /v1/flights/search); the old POST /v1/flight-searches fan-out is staff-only and not load-tested here.
// Local:   docker run --rm -i --network host -e API=http://localhost:4100 grafana/k6:1.3.0 run - < infra/load/search.k6.js
// Staging: set API and RATE (requests/s); each virtual user appears as its own address behind the proxy.
import http from "k6/http"
import { check, sleep } from "k6"
import { Rate } from "k6/metrics"

const API = __ENV.API || "http://localhost:4100"
const RATE = Number(__ENV.RATE || 20)
const DURATION = __ENV.DURATION || "60s"

const answered = new Rate("flights_search_answered")

export const options = {
  scenarios: {
    flights: { executor: "constant-arrival-rate", rate: RATE, timeUnit: "1s", duration: DURATION, preAllocatedVUs: 20, maxVUs: 200, exec: "flightsSearch" },
    browse: { executor: "constant-vus", vus: 10, duration: DURATION, exec: "browse" },
  },
  thresholds: {
    // ADR-0034: the catalog answers from Redis snapshots, p95 under 100 ms at the API.
    "http_req_duration{name:flights_search}": ["p(95)<100"],
    "http_req_duration{name:locations}": ["p(95)<200"],
    http_req_failed: ["rate<0.01"],
    flights_search_answered: ["rate>0.99"],
  },
}

// Tracked pairs (the seeded watchlist: IKA->IST, IST->LHR and the combined THR->LON) plus an untracked one for the NOT_TRACKED state.
const ROUTES = [["THR", "LON"], ["IKA", "IST"], ["IST", "LHR"], ["THR", "IST"], ["MHD", "FRA"]]
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${1 + ((Math.random() * 250) | 0)}`
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

export function flightsSearch() {
  const [from, to] = ROUTES[(Math.random() * ROUTES.length) | 0]
  const headers = { "x-forwarded-for": ip(), "user-agent": `k6-${__VU}` }
  const flex = (Math.random() * 4) | 0
  const r = http.get(`${API}/v1/flights/search?from=${from}&to=${to}&date=${day(1 + ((Math.random() * 13) | 0))}&flex=${flex}`, { headers, tags: { name: "flights_search" } })
  answered.add(check(r, { "search 200": (x) => x.status === 200, "has a state": (x) => !!x.json("state") }))
  // A repeat with the ETag is a 304 and must be as fast.
  const etag = r.headers.Etag
  if (etag) check(http.get(r.url, { headers: { ...headers, "if-none-match": etag }, tags: { name: "flights_search" } }), { "revalidates": (x) => x.status === 304 })
}

export function browse() {
  const q = ["teh", "lon", "tab", "ist", "van", "مشه"][(Math.random() * 6) | 0]
  const headers = { "x-forwarded-for": ip() }
  check(http.get(`${API}/v1/locations?q=${encodeURIComponent(q)}`, { headers, tags: { name: "locations" } }), { "locations 200": (x) => x.status === 200 })
  check(http.get(`${API}/health`, { headers, tags: { name: "health" } }), { "health 200": (x) => x.status === 200 })
  sleep(1)
}
