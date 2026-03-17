-- Organization + membership tenancy model
CREATE TYPE "OrganizationMembershipRole" AS ENUM ('OWNER', 'ADMIN');
CREATE TYPE "LeagueMembershipStatus" AS ENUM ('ACTIVE', 'REMOVED');

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

ALTER TABLE "League" ADD COLUMN "organizationId" TEXT;

CREATE TABLE "OrganizationMembership" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "OrganizationMembershipRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key"
  ON "OrganizationMembership"("organizationId", "userId");
CREATE INDEX "OrganizationMembership_userId_idx"
  ON "OrganizationMembership"("userId");

CREATE TABLE "LeagueMembership" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "leagueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "LeagueMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeagueMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeagueMembership_leagueId_userId_key"
  ON "LeagueMembership"("leagueId", "userId");
CREATE INDEX "LeagueMembership_userId_status_idx"
  ON "LeagueMembership"("userId", "status");

ALTER TABLE "OrganizationMembership"
  ADD CONSTRAINT "OrganizationMembership_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrganizationMembership"
  ADD CONSTRAINT "OrganizationMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeagueMembership"
  ADD CONSTRAINT "LeagueMembership_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "League"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeagueMembership"
  ADD CONSTRAINT "LeagueMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Organization" ("name", "slug", "updatedAt")
VALUES ('HBK Rec League', 'hbk-rec-league', CURRENT_TIMESTAMP);

UPDATE "League"
SET "organizationId" = (
  SELECT "id"
  FROM "Organization"
  WHERE "slug" = 'hbk-rec-league'
)
WHERE "organizationId" IS NULL;

INSERT INTO "OrganizationMembership" ("organizationId", "userId", "role", "updatedAt")
SELECT
  org."id",
  u."id",
  'OWNER'::"OrganizationMembershipRole",
  CURRENT_TIMESTAMP
FROM "User" u
CROSS JOIN "Organization" org
WHERE org."slug" = 'hbk-rec-league'
  AND u."role" = 'ADMIN'
ON CONFLICT ("organizationId", "userId") DO UPDATE
SET "role" = EXCLUDED."role", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "LeagueMembership" ("leagueId", "userId", "status", "updatedAt")
SELECT DISTINCT
  memberships."leagueId",
  memberships."userId",
  'ACTIVE'::"LeagueMembershipStatus",
  CURRENT_TIMESTAMP
FROM (
  SELECT sa."leagueId", sa."userId"
  FROM "SlotAssignment" sa

  UNION

  SELECT s."leagueId", sr."userId"
  FROM "SessionRegistration" sr
  INNER JOIN "SessionOccurrence" so ON so."id" = sr."occurrenceId"
  INNER JOIN "Session" s ON s."id" = so."sessionId"

  UNION

  SELECT s."leagueId", ss."userId"
  FROM "SubSignup" ss
  INNER JOIN "SessionOccurrence" so ON so."id" = ss."occurrenceId"
  INNER JOIN "Session" s ON s."id" = so."sessionId"
) memberships
ON CONFLICT ("leagueId", "userId") DO UPDATE
SET "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "League"
  ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "League"
  ADD CONSTRAINT "League_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "League_organizationId_status_idx"
  ON "League"("organizationId", "status");

CREATE UNIQUE INDEX "League_one_active_per_org_idx"
  ON "League"("organizationId")
  WHERE "status" = 'ACTIVE';

-- Remove legacy global user role
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "UserRole";
