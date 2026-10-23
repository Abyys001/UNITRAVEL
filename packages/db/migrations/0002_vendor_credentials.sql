CREATE TABLE "vendor_credentials" (
	"vendor" varchar(40) NOT NULL,
	"environment" text NOT NULL,
	"ciphertext" text NOT NULL,
	"key_id" varchar(40) NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by" uuid,
	CONSTRAINT "vendor_credentials_vendor_environment_pk" PRIMARY KEY("vendor","environment")
);
