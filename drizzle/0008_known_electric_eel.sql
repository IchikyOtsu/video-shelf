-- Accounts created before mandatory verification remain usable.
UPDATE "users" SET "email_verified_at" = now() WHERE "email_verified_at" IS NULL;
