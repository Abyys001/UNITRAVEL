# Runbook: cargo operations (ADR-0042, ADR-0043)

- **Add an agent:** Admin Panel › Cargo operations › Agent Management › Add agent (needs `cargo_agent.manage`). Choose the agent type (driver, courier, collection agent, delivery agent, logistics representative, other) and responsibilities (collection, handling, delivery). The account with that email gets only the `agent` role (created if absent) and an Agent ID (AG-00001…). The agent signs in at the admin host with the emailed code and enrols a second factor, then lands on the Agent Dashboard. Set a public name if customers should see something other than "Agent AG-…". Deactivate to remove the role (reassign open jobs first).
- **Assign agents:** request page › Shipment operations › Assign agent. Pick one or several agents for collection (booked → received), handling (handover → before delivery) or delivery (received onwards). Agents set to require acceptance get an offer; a decline notifies whoever assigned it. The place is shown publicly: a town or facility only.
- **Create a request for a customer:** Cargo operations › New request (needs `cargo_request.create.any`); look the customer up by exact email, phone or UT-C reference, or create the customer; tick that the customer confirmed the declarations.
- **Tracking number:** issued automatically when the request is ACCEPTED; "Issue tracking number" covers older shipments.
- **Labels:** request page › Labels. 4×6 for thermal printers, A6, or A4 with four A6 labels and cut marks. A new label voids the previous one.
- **Failed deliveries:** after 3 failed attempts the delivery job closes; decide in the request page (assign again, raise exception HELD or RETURNED).
- **Notices:** Cargo operations › Email notifications lists every milestone notice (customer and recipient) with email/SMS state. A milestone is never sent twice.
- **Deploy:** migrations 0032–0034 + seed (agent role, templates); clear Valkey `perm:*` after deploy.
- **Flight request for a customer (ADR-0044):** Requests › New request (needs `flight_request.create.any`): find or create the customer, enter the journey and travellers (passport optional). Nothing has to be verified.
- **Ticketing an unverified traveller (ADR-0044):** in Record tickets, the dialog lists unverified travellers; write why you are ticketing without verification (≥ 10 characters). It is stored on the request and audited (`flight_request.identity_override`).
- **Deploy:** migrations up to 0035; clear Valkey `perm:*`.
- **Waiting for the customer:** on a flight or cargo request in AWAITING_CUSTOMER use **Continue without reply…** and write why (e.g. the customer answered by phone). Quotes the customer accepted by phone: **Record acceptance…**.
