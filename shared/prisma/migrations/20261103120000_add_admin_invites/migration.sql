-- CreateTable
CREATE TABLE "admin_invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" VARCHAR(64) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "permissions" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "invited_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_invites_token_key" ON "admin_invites"("token");
CREATE INDEX "admin_invites_email_idx" ON "admin_invites"("email");

-- AddForeignKey
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
