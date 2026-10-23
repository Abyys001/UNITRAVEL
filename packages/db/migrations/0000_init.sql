CREATE TYPE "public"."client_kind" AS ENUM('WEB', 'CONSOLE', 'MOBILE');--> statement-breakpoint
CREATE TYPE "public"."identity_type" AS ENUM('PHONE', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('SIGN_IN', 'VERIFY_PHONE', 'VERIFY_EMAIL', 'STEP_UP');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."flight_request_status" AS ENUM('SUBMITTED', 'COMPLIANCE_HOLD', 'NEW', 'IN_REVIEW', 'AWAITING_CUSTOMER', 'QUOTED', 'ACCEPTED', 'RESERVED', 'TICKETED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('NONE', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('FLIGHT', 'CARGO', 'AFTER_SALES');--> statement-breakpoint
CREATE TYPE "public"."cargo_service" AS ENUM('DOCUMENTS', 'PARCEL', 'EXCESS_BAGGAGE', 'AIR_FREIGHT');--> statement-breakpoint
CREATE TYPE "public"."cargo_status" AS ENUM('SUBMITTED', 'COMPLIANCE_HOLD', 'NEW', 'IN_REVIEW', 'AWAITING_CUSTOMER', 'QUOTED', 'ACCEPTED', 'BOOKED', 'AWAITING_HANDOVER', 'RECEIVED', 'IN_TRANSIT', 'AT_CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'EXCEPTION', 'DECLINED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"push_provider" text NOT NULL,
	"push_token" varchar(4096) NOT NULL,
	"last_success_at" timestamp with time zone,
	"app_version" varchar(40),
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"secret_ciphertext" text,
	"credential_id" varchar(512),
	"public_key" text,
	"counter" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identity_value" varchar(254) NOT NULL,
	"identity_type" "identity_type" NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"user_id" uuid,
	"code_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"route" varchar(40),
	"delivery_status" text DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" varchar(120),
	"ip" varchar(64),
	"ip_prefix" varchar(64),
	"device_id" varchar(128) NOT NULL,
	"voice" boolean DEFAULT false NOT NULL,
	"consumed_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"new_phone" varchar(32) NOT NULL,
	"evidence_note" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" varchar(80) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"privileged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" varchar(128),
	"client" "client_kind" NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(400),
	"mfa_level" integer DEFAULT 0 NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "identity_type" NOT NULL,
	"value_normalised" varchar(254) NOT NULL,
	"verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"preferred_locale" text DEFAULT 'en' NOT NULL,
	"calendar" text DEFAULT 'GREGORIAN' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/London' NOT NULL,
	"perm_version" integer DEFAULT 1 NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"on_duty" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp with time zone,
	"merged_into" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"given_names_latin" varchar(80),
	"surname_latin" varchar(80),
	"name_fa" varchar(120),
	"contact_time_pref" varchar(80),
	"terms_version" varchar(20),
	"privacy_version" varchar(20),
	"marketing_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traveller_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"traveller_id" uuid NOT NULL,
	"type" text NOT NULL,
	"number_ciphertext" text NOT NULL,
	"number_last4" varchar(4) NOT NULL,
	"issuing_country" varchar(2) NOT NULL,
	"expiry_date" date NOT NULL,
	"key_id" varchar(40) NOT NULL,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travellers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"given_names" varchar(80) NOT NULL,
	"surname" varchar(80) NOT NULL,
	"name_fa" varchar(120),
	"date_of_birth" date NOT NULL,
	"gender_on_document" text NOT NULL,
	"nationality" varchar(2) NOT NULL,
	"relationship" text DEFAULT 'SELF' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aircraft_types" (
	"code" varchar(4) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airlines" (
	"iata" varchar(3) PRIMARY KEY NOT NULL,
	"icao" varchar(3),
	"accounting_code" varchar(3),
	"name" varchar(120) NOT NULL,
	"country" varchar(2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airports" (
	"iata" varchar(3) PRIMARY KEY NOT NULL,
	"icao" varchar(4),
	"name_en" varchar(120) NOT NULL,
	"name_fa" varchar(120) NOT NULL,
	"city_code" varchar(3),
	"country" varchar(2) NOT NULL,
	"tz" varchar(64) NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"metro_code" varchar(3),
	"active" boolean DEFAULT true NOT NULL,
	"source" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"name_en" varchar(80) NOT NULL,
	"name_fa" varchar(80) NOT NULL,
	"country" varchar(2) NOT NULL,
	"region_tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" varchar(2) PRIMARY KEY NOT NULL,
	"name_en" varchar(80) NOT NULL,
	"name_fa" varchar(80) NOT NULL,
	"region_tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"search_result_id" uuid,
	"search_id" uuid,
	"itinerary" jsonb NOT NULL,
	"components" jsonb NOT NULL,
	"price_at_submit_minor" bigint NOT NULL,
	"price_revalidated_minor" bigint,
	"currency" varchar(3) NOT NULL,
	"revalidated_at" timestamp with time zone,
	"rule_version" integer NOT NULL,
	"engine_version" varchar(40) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_calls" (
	"id" uuid NOT NULL,
	"provider_id" varchar(40) NOT NULL,
	"operation" varchar(40) NOT NULL,
	"search_id" uuid,
	"request_id" varchar(128),
	"status" text NOT NULL,
	"error_code" varchar(40),
	"duration_ms" integer NOT NULL,
	"size_bytes" integer,
	"offers" integer,
	"payload_key" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_calls_id_created_at_pk" PRIMARY KEY("id","created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"provider_id" varchar(40) NOT NULL,
	"environment" text NOT NULL,
	"ciphertext" text NOT NULL,
	"key_id" varchar(40) NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by" uuid,
	CONSTRAINT "provider_credentials_provider_id_environment_pk" PRIMARY KEY("provider_id","environment")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"environment" text DEFAULT 'test' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"capabilities" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"markets" jsonb NOT NULL,
	"shadow_mode" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"search_id" uuid NOT NULL,
	"itinerary_key" varchar(40) NOT NULL,
	"rank" integer NOT NULL,
	"tabs" text[] NOT NULL,
	"construction" text NOT NULL,
	"itinerary" jsonb NOT NULL,
	"price_total_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"duration_min" integer NOT NULL,
	"risk_flags" text[] NOT NULL,
	"score" numeric(8, 4) NOT NULL,
	"score_components" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"actor_kind" text NOT NULL,
	"anon_key" varchar(128),
	"query" jsonb NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"rule_version" integer NOT NULL,
	"hubs_version" integer NOT NULL,
	"engine_version" varchar(40) NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"collected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "after_sales_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" varchar(12) NOT NULL,
	"original_request_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"ticket_ids" uuid[] NOT NULL,
	"note" text,
	"resolution_note" text,
	"assignee_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "after_sales_cases_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "contact_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_type" "request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"outcome" text NOT NULL,
	"call_back_at" timestamp with time zone,
	"note" text,
	"template_key" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" varchar(12) NOT NULL,
	"product_type" text DEFAULT 'FLIGHT' NOT NULL,
	"kind" text NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"contact_identity_id" uuid NOT NULL,
	"contact_phone_snapshot" varchar(16) NOT NULL,
	"contact_phone_verified" boolean NOT NULL,
	"alternative_contact" jsonb,
	"status" "flight_request_status" DEFAULT 'SUBMITTED' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'NONE' NOT NULL,
	"assignee_user_id" uuid,
	"offer_snapshot_id" uuid,
	"trip_type" text NOT NULL,
	"query" jsonb NOT NULL,
	"manual" jsonb,
	"preferences" jsonb NOT NULL,
	"customer_note" text,
	"submitted_via" text DEFAULT 'WEB' NOT NULL,
	"submitted_locale" text DEFAULT 'en' NOT NULL,
	"first_travel_date" date NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"sla_due_at" timestamp with time zone,
	"first_contact_at" timestamp with time zone,
	"assigned_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flight_requests_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_type" "request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"method" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"external_reference" varchar(80) NOT NULL,
	"payer_name" varchar(120) NOT NULL,
	"payer_screening_id" uuid,
	"evidence_document_id" uuid,
	"status" text DEFAULT 'RECORDED' NOT NULL,
	"atol_certificate_document_id" uuid,
	"recorded_by" uuid NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" varchar(80) NOT NULL,
	"source" text NOT NULL,
	"attested_by" uuid,
	"itinerary" jsonb NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_breakdown" jsonb NOT NULL,
	"total_minor" bigint NOT NULL,
	"baggage" jsonb NOT NULL,
	"conditions" jsonb NOT NULL,
	"ticketing_model" text NOT NULL,
	"internal_cost_minor" bigint,
	"supplier_price" jsonb,
	"supplier_fetched_at" timestamp with time zone,
	"supplier_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_type" "request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"valid_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_option_id" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_via" text,
	"acceptance_note" text,
	"cargo_lines" jsonb,
	"cargo_partner_id" uuid,
	"transit_note" text,
	"partner_cost_minor" bigint,
	"created_by" uuid NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_type" "request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" uuid,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"document_ids" uuid[] DEFAULT '{}' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_type" "request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_type" "request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30) NOT NULL,
	"command" varchar(40) NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"reason_code" varchar(40),
	"reason_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_travellers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"passenger_type" text NOT NULL,
	"name_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reservation_id" uuid NOT NULL,
	"slice_index" integer NOT NULL,
	"segment_index" integer NOT NULL,
	"carrier" varchar(3) NOT NULL,
	"flight_number" varchar(5) NOT NULL,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"departure_utc" timestamp with time zone NOT NULL,
	"status" varchar(4) DEFAULT 'HK' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"system" text NOT NULL,
	"record_locator" varchar(6) NOT NULL,
	"airline_locators" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"ticketing_deadline" timestamp with time zone NOT NULL,
	"quote_option_id" uuid,
	"traveller_ids" uuid[] NOT NULL,
	"segments" jsonb NOT NULL,
	"mismatch_reason" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"ticket_number" char(13) NOT NULL,
	"validating_carrier" varchar(3) NOT NULL,
	"issue_date" date NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"coupons" jsonb NOT NULL,
	"document_id" uuid,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_ticketNumber_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "cargo_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cargo_request_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" varchar(40) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_value_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"hs_code" varchar(10),
	"origin_country" varchar(2) NOT NULL,
	"purpose" varchar(30) NOT NULL,
	"screening_outcome" text DEFAULT 'ALLOWED' NOT NULL,
	"matched_rule" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cargo_lanes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"origin_country" varchar(2) NOT NULL,
	"destination_country" varchar(2) NOT NULL,
	"services" "cargo_service"[] NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"requires_compliance_approval" boolean DEFAULT false NOT NULL,
	"volumetric_divisor" integer DEFAULT 5000 NOT NULL,
	"customer_notice" jsonb,
	"counsel_reference" varchar(120),
	"enabled_by_owner" uuid,
	"enabled_by_compliance" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cargo_pieces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cargo_request_id" uuid NOT NULL,
	"length_cm" numeric(6, 1) NOT NULL,
	"width_cm" numeric(6, 1) NOT NULL,
	"height_cm" numeric(6, 1) NOT NULL,
	"weight_kg" numeric(8, 2) NOT NULL,
	"verified_weight_kg" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cargo_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" varchar(12) NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"service" "cargo_service" NOT NULL,
	"lane_id" uuid NOT NULL,
	"status" "cargo_status" DEFAULT 'SUBMITTED' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'NONE' NOT NULL,
	"assignee_user_id" uuid,
	"shipper_identity_id" uuid NOT NULL,
	"shipper" jsonb NOT NULL,
	"consignee" jsonb NOT NULL,
	"purpose" varchar(30),
	"declared_value_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"insurance_requested" boolean DEFAULT false NOT NULL,
	"ready_date" date NOT NULL,
	"handover_mode" text NOT NULL,
	"dg_declared" boolean DEFAULT false NOT NULL,
	"declarations" jsonb NOT NULL,
	"commercial" jsonb,
	"customer_note" text,
	"exception_reason" varchar(20),
	"exception_resume_to" varchar(30),
	"sla_due_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargo_requests_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "partner_bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cargo_request_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"partner_reference" varchar(60) NOT NULL,
	"awb_number" varchar(12),
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"type" text NOT NULL,
	"lane_ids" uuid[] DEFAULT '{}' NOT NULL,
	"services" "cargo_service"[] DEFAULT '{}' NOT NULL,
	"integration_level" text DEFAULT 'MANUAL' NOT NULL,
	"compliance_status" text DEFAULT 'PENDING' NOT NULL,
	"last_screened_at" timestamp with time zone,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sla_note" text,
	"cut_off_note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_availability" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_name" varchar(160) NOT NULL,
	"lane" varchar(5) NOT NULL,
	"service" "cargo_service" NOT NULL,
	"status" text NOT NULL,
	"source_url" text NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cargo_request_id" uuid NOT NULL,
	"event_code" varchar(30) NOT NULL,
	"location" varchar(120) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" text,
	"source" text DEFAULT 'STAFF' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_type" "request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"request_ref" varchar(12) NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"screening_ids" uuid[] DEFAULT '{}' NOT NULL,
	"requires_four_eyes" boolean DEFAULT false NOT NULL,
	"assigned_to" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"reason_code" varchar(40),
	"counsel_reference" varchar(120),
	"decided_by" uuid NOT NULL,
	"second_approver" uuid,
	"supersedes" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"key" varchar(120) NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"counsel_reference" varchar(120),
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"seeded_pending_counsel" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanction_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_version_id" uuid NOT NULL,
	"list_id" text NOT NULL,
	"external_id" varchar(80) NOT NULL,
	"type" text NOT NULL,
	"names" jsonb NOT NULL,
	"dob" text[] DEFAULT '{}' NOT NULL,
	"nationalities" text[] DEFAULT '{}' NOT NULL,
	"identifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"programmes" text[] DEFAULT '{}' NOT NULL,
	"search_tokens" text[] NOT NULL,
	"search_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanction_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"source_url" text NOT NULL,
	"version_hash" varchar(64) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_count" integer NOT NULL,
	"status" text NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "screening_hits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"screening_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"matched_name" varchar(240) NOT NULL,
	"reasons" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screenings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_ref" varchar(80) NOT NULL,
	"subject_name" varchar(240) NOT NULL,
	"context_ref" varchar(40),
	"lists_version" jsonb NOT NULL,
	"result" text NOT NULL,
	"candidates_considered" integer DEFAULT 0 NOT NULL,
	"thresholds" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" varchar(80),
	"context_ref" varchar(40),
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(64),
	"user_agent" varchar(400),
	"request_id" varchar(128),
	"prev_hash" varchar(64) NOT NULL,
	"hash" varchar(64) NOT NULL,
	CONSTRAINT "audit_log_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
CREATE TABLE "config_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"change_note" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"request_type" "request_type",
	"request_id" uuid,
	"type" varchar(40) NOT NULL,
	"filename" varchar(200) NOT NULL,
	"mime" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"sha256" varchar(64),
	"scan_status" text DEFAULT 'PENDING' NOT NULL,
	"visibility" text DEFAULT 'INTERNAL' NOT NULL,
	"upload_completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"owner" varchar(80) NOT NULL,
	"remove_by" varchar(10),
	"description" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" varchar(128) NOT NULL,
	"user_id" varchar(80) NOT NULL,
	"route" varchar(200) NOT NULL,
	"body_hash" varchar(64) NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_user_id_route_pk" PRIMARY KEY("key","user_id","route")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue" varchar(60) NOT NULL,
	"name" varchar(80) NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider" varchar(40),
	"destination" varchar(260),
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" varchar(160),
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"channel" text NOT NULL,
	"locale" text NOT NULL,
	"title" varchar(240) DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"variables" text[] NOT NULL,
	"provider_template_id" varchar(120),
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"event_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"dedupe_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupeKey_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" varchar(40) NOT NULL,
	"aggregate_id" varchar(80) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "outbox_events_dedupeKey_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "process_heartbeats" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"config_versions" jsonb NOT NULL,
	"app_version" varchar(40) NOT NULL,
	"last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_links" (
	"code" varchar(12) PRIMARY KEY NOT NULL,
	"target" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sms_routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prefix" varchar(8) NOT NULL,
	"providers" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_routes_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_requests" ADD CONSTRAINT "recovery_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD CONSTRAINT "traveller_documents_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travellers" ADD CONSTRAINT "travellers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airports" ADD CONSTRAINT "airports_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_original_request_id_flight_requests_id_fk" FOREIGN KEY ("original_request_id") REFERENCES "public"."flight_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_request_id_flight_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."flight_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_requests" ADD CONSTRAINT "flight_requests_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_requests" ADD CONSTRAINT "flight_requests_contact_identity_id_user_identities_id_fk" FOREIGN KEY ("contact_identity_id") REFERENCES "public"."user_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_requests" ADD CONSTRAINT "flight_requests_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_requests" ADD CONSTRAINT "flight_requests_offer_snapshot_id_offer_snapshots_id_fk" FOREIGN KEY ("offer_snapshot_id") REFERENCES "public"."offer_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_attested_by_users_id_fk" FOREIGN KEY ("attested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_travellers" ADD CONSTRAINT "request_travellers_request_id_flight_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."flight_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_travellers" ADD CONSTRAINT "request_travellers_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_segments" ADD CONSTRAINT "reservation_segments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_request_id_flight_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."flight_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_quote_option_id_quote_options_id_fk" FOREIGN KEY ("quote_option_id") REFERENCES "public"."quote_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_request_id_flight_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."flight_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_traveller_id_travellers_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."travellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_items" ADD CONSTRAINT "cargo_items_cargo_request_id_cargo_requests_id_fk" FOREIGN KEY ("cargo_request_id") REFERENCES "public"."cargo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_pieces" ADD CONSTRAINT "cargo_pieces_cargo_request_id_cargo_requests_id_fk" FOREIGN KEY ("cargo_request_id") REFERENCES "public"."cargo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD CONSTRAINT "cargo_requests_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD CONSTRAINT "cargo_requests_lane_id_cargo_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."cargo_lanes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD CONSTRAINT "cargo_requests_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD CONSTRAINT "cargo_requests_shipper_identity_id_user_identities_id_fk" FOREIGN KEY ("shipper_identity_id") REFERENCES "public"."user_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_bookings" ADD CONSTRAINT "partner_bookings_cargo_request_id_cargo_requests_id_fk" FOREIGN KEY ("cargo_request_id") REFERENCES "public"."cargo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_bookings" ADD CONSTRAINT "partner_bookings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_bookings" ADD CONSTRAINT "partner_bookings_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_availability" ADD CONSTRAINT "service_availability_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_cargo_request_id_cargo_requests_id_fk" FOREIGN KEY ("cargo_request_id") REFERENCES "public"."cargo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_decisions" ADD CONSTRAINT "compliance_decisions_case_id_compliance_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."compliance_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanction_entries" ADD CONSTRAINT "sanction_entries_list_version_id_sanction_lists_id_fk" FOREIGN KEY ("list_version_id") REFERENCES "public"."sanction_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_hits" ADD CONSTRAINT "screening_hits_screening_id_screenings_id_fk" FOREIGN KEY ("screening_id") REFERENCES "public"."screenings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_hits" ADD CONSTRAINT "screening_hits_entry_id_sanction_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."sanction_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_uq" ON "devices" USING btree ("push_provider","push_token");--> statement-breakpoint
CREATE INDEX "otp_identity_idx" ON "otp_challenges" USING btree ("identity_value","created_at");--> statement-breakpoint
CREATE INDEX "refresh_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_value_uq" ON "user_identities" USING btree ("type","value_normalised") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "traveller_documents_traveller_idx" ON "traveller_documents" USING btree ("traveller_id");--> statement-breakpoint
CREATE INDEX "travellers_owner_idx" ON "travellers" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "provider_calls_provider_idx" ON "provider_calls" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "search_results_search_idx" ON "search_results" USING btree ("search_id","rank");--> statement-breakpoint
CREATE INDEX "search_results_key_idx" ON "search_results" USING btree ("itinerary_key");--> statement-breakpoint
CREATE INDEX "searches_user_idx" ON "searches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_attempts_idx" ON "contact_attempts" USING btree ("request_type","request_id");--> statement-breakpoint
CREATE INDEX "fr_queue_idx" ON "flight_requests" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "fr_customer_idx" ON "flight_requests" USING btree ("customer_user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "fr_assignee_idx" ON "flight_requests" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "payment_records_request_idx" ON "payment_records" USING btree ("request_type","request_id");--> statement-breakpoint
CREATE INDEX "quote_options_quote_idx" ON "quote_options" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_request_idx" ON "quotes" USING btree ("request_type","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_request_version_uq" ON "quotes" USING btree ("request_type","request_id","version");--> statement-breakpoint
CREATE INDEX "request_messages_idx" ON "request_messages" USING btree ("request_type","request_id","created_at");--> statement-breakpoint
CREATE INDEX "request_notes_idx" ON "request_notes" USING btree ("request_type","request_id");--> statement-breakpoint
CREATE INDEX "rsh_request_idx" ON "request_status_history" USING btree ("request_type","request_id","created_at");--> statement-breakpoint
CREATE INDEX "request_travellers_req_idx" ON "request_travellers" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "reservations_request_idx" ON "reservations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "tickets_request_idx" ON "tickets" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "cargo_queue_idx" ON "cargo_requests" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "cargo_customer_idx" ON "cargo_requests" USING btree ("customer_user_id");--> statement-breakpoint
CREATE INDEX "tracking_req_idx" ON "tracking_events" USING btree ("cargo_request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "compliance_cases" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "cases_request_idx" ON "compliance_cases" USING btree ("request_type","request_id");--> statement-breakpoint
CREATE INDEX "policies_type_idx" ON "compliance_policies" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "sanction_entries_version_idx" ON "sanction_entries" USING btree ("list_version_id");--> statement-breakpoint
CREATE INDEX "sanction_lists_list_idx" ON "sanction_lists" USING btree ("list_id","fetched_at");--> statement-breakpoint
CREATE INDEX "screenings_subject_idx" ON "screenings" USING btree ("subject_type","subject_ref");--> statement-breakpoint
CREATE INDEX "screenings_context_idx" ON "screenings" USING btree ("context_ref");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_ref_idx" ON "audit_log" USING btree ("context_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "config_versions_uq" ON "config_versions" USING btree ("domain","version");--> statement-breakpoint
CREATE INDEX "documents_request_idx" ON "documents" USING btree ("request_type","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_notification_channel_uq" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "deliveries_provider_idx" ON "notification_deliveries" USING btree ("provider","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_uq" ON "notification_templates" USING btree ("event_type","channel","locale");--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("dispatched_at","created_at");