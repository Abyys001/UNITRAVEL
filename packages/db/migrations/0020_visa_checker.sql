-- ADR-0029: visa eligibility and travel document checker. Hand-written like 0003-0019; the journal entry is added by hand.
CREATE TABLE "travel_document_types" (
	"code" varchar(40) PRIMARY KEY NOT NULL CHECK ("code" ~ '^[A-Z][A-Z0-9_]{2,39}$'),
	"name" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"category" text NOT NULL CHECK ("category" IN ('NATIONAL_PASSPORT','BRITISH_NATIONALITY_PASSPORT','REFUGEE','STATELESS','OTHER_NON_NATIONAL')),
	"issuing_country" varchar(2) CHECK ("issuing_country" ~ '^[A-Z]{2}$'),
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "visa_trusted_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"country" varchar(2) CHECK ("country" ~ '^[A-Z]{2}$'),
	"url" varchar(500) NOT NULL CHECK ("url" LIKE 'https://%'),
	"title" varchar(200) NOT NULL,
	"kind" text NOT NULL CHECK ("kind" IN ('GOVUK_FTA','DESTINATION_IMMIGRATION','OFFICIAL_VISA_PORTAL','EMBASSY_CONSULATE','OTHER_GOVERNMENT','IATA','THIRD_PARTY')),
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"last_fetched_at" timestamp with time zone,
	"last_status" varchar(40),
	"created_by" uuid REFERENCES "users"("id"),
	"updated_by" uuid REFERENCES "users"("id"),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "visa_trusted_sources_url_uq" ON "visa_trusted_sources" ("country", "url");--> statement-breakpoint
CREATE INDEX "visa_trusted_sources_country_idx" ON "visa_trusted_sources" ("country", "active");--> statement-breakpoint
CREATE TABLE "visa_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"destination" varchar(2) NOT NULL CHECK ("destination" ~ '^[A-Z]{2}$'),
	"document_type" varchar(40) NOT NULL REFERENCES "travel_document_types"("code"),
	"issuing_country" varchar(2) NOT NULL CHECK ("issuing_country" ~ '^[A-Z]{2}$'),
	"purpose" text NOT NULL CHECK ("purpose" IN ('VISIT','TRANSIT')),
	"status" text NOT NULL CHECK ("status" IN ('VISA_FREE','EVISA','ETA','VISA_ON_ARRIVAL','VISA_REQUIRED','TRANSIT_VISA','SPECIAL_PERMISSION','NOT_ACCEPTED','UNCONFIRMED')),
	"facts" jsonb NOT NULL,
	"verification" text NOT NULL CHECK ("verification" IN ('VERIFIED','UNVERIFIED','CONFLICT','OVERRIDDEN')),
	"origin" text NOT NULL CHECK ("origin" IN ('RESEARCH','MANUAL')),
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"override_reason" text,
	"updated_by" uuid REFERENCES "users"("id"),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The gate in code, repeated here: an unconfirmed or conflicting row cannot carry a confirming status, and an override has a reason.
	CONSTRAINT "visa_rules_status_verification_ck" CHECK ("verification" IN ('VERIFIED','OVERRIDDEN') OR "status" = 'UNCONFIRMED'),
	CONSTRAINT "visa_rules_override_reason_ck" CHECK ("verification" <> 'OVERRIDDEN' OR "override_reason" IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX "visa_rules_key_uq" ON "visa_rules" ("destination", "document_type", "issuing_country", "purpose");--> statement-breakpoint
CREATE INDEX "visa_rules_review_idx" ON "visa_rules" ("verification", "expires_at");--> statement-breakpoint
CREATE TABLE "visa_research_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"destination" varchar(2) NOT NULL,
	"document_type" varchar(40) NOT NULL,
	"issuing_country" varchar(2) NOT NULL,
	"purpose" text NOT NULL CHECK ("purpose" IN ('VISIT','TRANSIT')),
	"trigger" text NOT NULL CHECK ("trigger" IN ('CHECK','FRESH','STALE','STAFF')),
	"status" text DEFAULT 'QUEUED' NOT NULL CHECK ("status" IN ('QUEUED','RUNNING','DONE','FAILED','NOT_CONFIGURED')),
	"rule_id" uuid REFERENCES "visa_rules"("id"),
	"result_status" varchar(24),
	"result_verification" varchar(16),
	"fetches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dropped_claims" integer DEFAULT 0 NOT NULL,
	"model" varchar(60),
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"requested_by" uuid REFERENCES "users"("id"),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "visa_research_runs_status_idx" ON "visa_research_runs" ("status", "created_at");--> statement-breakpoint
CREATE INDEX "visa_research_runs_key_idx" ON "visa_research_runs" ("destination", "document_type", "created_at");--> statement-breakpoint
CREATE TABLE "visa_research_credentials" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"key_id" varchar(40) NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by" uuid REFERENCES "users"("id")
);--> statement-breakpoint
INSERT INTO "travel_document_types" ("code", "name", "description", "category", "issuing_country", "sort_order") VALUES
	('GB_CITIZEN_PASSPORT', '{"en":"British citizen passport","fa":"گذرنامهٔ شهروند بریتانیا (British citizen)"}', '{"en":"A full UK passport that says \"British Citizen\" under nationality.","fa":"گذرنامهٔ کامل بریتانیا که در بخش ملیت آن «British Citizen» نوشته شده است."}', 'BRITISH_NATIONALITY_PASSPORT', 'GB', 10),
	('GB_BNO_PASSPORT', '{"en":"British National (Overseas) passport, BN(O)","fa":"گذرنامهٔ تبعهٔ بریتانیا (برون‌مرزی)، BN(O)"}', '{"en":"Nationality reads \"British National (Overseas)\". Entry rules often differ from British citizen passports.","fa":"در بخش ملیت «British National (Overseas)» نوشته شده است. قوانین ورود اغلب با گذرنامهٔ شهروند بریتانیا فرق دارد."}', 'BRITISH_NATIONALITY_PASSPORT', 'GB', 20),
	('GB_BOTC_PASSPORT', '{"en":"British Overseas Territories Citizen passport","fa":"گذرنامهٔ شهروند سرزمین‌های برون‌مرزی بریتانیا (BOTC)"}', '{"en":"Issued to citizens of a British Overseas Territory.","fa":"برای شهروندان سرزمین‌های برون‌مرزی بریتانیا صادر می‌شود."}', 'BRITISH_NATIONALITY_PASSPORT', 'GB', 30),
	('GB_BOC_PASSPORT', '{"en":"British Overseas Citizen passport","fa":"گذرنامهٔ شهروند برون‌مرزی بریتانیا (BOC)"}', '{"en":"Nationality reads \"British Overseas Citizen\".","fa":"در بخش ملیت «British Overseas Citizen» نوشته شده است."}', 'BRITISH_NATIONALITY_PASSPORT', 'GB', 40),
	('GB_SUBJECT_PASSPORT', '{"en":"British subject passport","fa":"گذرنامهٔ British subject"}', '{"en":"Nationality reads \"British Subject\".","fa":"در بخش ملیت «British Subject» نوشته شده است."}', 'BRITISH_NATIONALITY_PASSPORT', 'GB', 50),
	('GB_BPP_PASSPORT', '{"en":"British protected person passport","fa":"گذرنامهٔ شخص تحت حمایت بریتانیا (BPP)"}', '{"en":"Nationality reads \"British Protected Person\".","fa":"در بخش ملیت «British Protected Person» نوشته شده است."}', 'BRITISH_NATIONALITY_PASSPORT', 'GB', 60),
	('GB_REFUGEE_TRAVEL_DOC', '{"en":"UK refugee travel document (1951 Convention)","fa":"سند سفر پناهندگی بریتانیا (کنوانسیون ۱۹۵۱)"}', '{"en":"The blue travel document for people with refugee status in the UK. It is not a British passport.","fa":"سند سفر آبی برای افرادی که در بریتانیا وضعیت پناهندگی دارند. این سند گذرنامهٔ بریتانیا نیست."}', 'REFUGEE', 'GB', 70),
	('GB_CERTIFICATE_OF_TRAVEL', '{"en":"UK certificate of travel","fa":"گواهی سفر بریتانیا (Certificate of Travel)"}', '{"en":"Issued by the Home Office to some people who cannot get a passport from their own country. It is not a British passport.","fa":"وزارت کشور بریتانیا آن را به برخی افرادی می‌دهد که نمی‌توانند از کشور خود گذرنامه بگیرند. این سند گذرنامهٔ بریتانیا نیست."}', 'OTHER_NON_NATIONAL', 'GB', 80),
	('GB_STATELESS_TRAVEL_DOC', '{"en":"UK stateless person travel document (1954 Convention)","fa":"سند سفر افراد بی‌تابعیت بریتانیا (کنوانسیون ۱۹۵۴)"}', '{"en":"For people recognised as stateless in the UK. It is not a British passport.","fa":"برای افرادی که در بریتانیا بی‌تابعیت شناخته شده‌اند. این سند گذرنامهٔ بریتانیا نیست."}', 'STATELESS', 'GB', 90),
	('NATIONAL_PASSPORT', '{"en":"Passport of another country","fa":"گذرنامهٔ کشور دیگر"}', '{"en":"A national passport issued by the country of your citizenship (choose the issuing country). Living in the UK does not change its rules.","fa":"گذرنامهٔ ملی صادرشده از کشور تابعیت شما (کشور صادرکننده را انتخاب کنید). زندگی در بریتانیا قوانین آن را تغییر نمی‌دهد."}', 'NATIONAL_PASSPORT', NULL, 100),
	('OTHER_TRAVEL_DOC', '{"en":"Other recognised travel document","fa":"سایر اسناد سفر شناخته‌شده"}', '{"en":"Any other travel document (choose the issuing country). Results for these are often unconfirmed.","fa":"هر سند سفر دیگر (کشور صادرکننده را انتخاب کنید). نتیجه برای این اسناد اغلب تأییدنشده است."}', 'OTHER_NON_NATIONAL', NULL, 110);--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES ('admin', 'visa.read'), ('admin', 'visa.write'), ('owner', 'visa.read'), ('owner', 'visa.write'), ('compliance_officer', 'visa.read')) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner', 'compliance_officer'));
