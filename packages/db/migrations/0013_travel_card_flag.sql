-- Travel card publication switch (Coming Soon page only). Hand-written like 0003-0012; the journal entry is added by hand.
-- Existing databases get the flag row here; new ones get it from the seed. Off by default.
INSERT INTO "feature_flags" ("key", "enabled", "owner", "remove_by", "description")
VALUES ('services.card.enabled', false, 'owner', NULL, 'Publishes the Travel card page as a Coming Soon notice; no card product exists, nothing can be issued or charged (brief 29 Oct 2026 section 18)')
ON CONFLICT ("key") DO NOTHING;
