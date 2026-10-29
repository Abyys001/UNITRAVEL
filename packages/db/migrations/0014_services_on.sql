-- Owner decision (29 Oct 2026): every service except the Travel card is live. Hotels, stays, trains, buses, visa, tours,
-- CIP and insurance are request forms (no provider listings, ADR-0015); the club is on; the Travel card publishes its
-- Coming Soon page only. Counsel items (O6, O7, O9, O10) stay UNKNOWN in docs/content/CLAIMS-TO-VERIFY.md.
UPDATE "feature_flags" SET "enabled" = true
WHERE "key" IN ('hotels.enabled', 'stays.enabled', 'trains.enabled', 'buses.enabled', 'services.visa.enabled', 'services.tours.enabled',
	'services.cip.enabled', 'services.insurance.enabled', 'services.card.enabled', 'loyalty.enabled');
