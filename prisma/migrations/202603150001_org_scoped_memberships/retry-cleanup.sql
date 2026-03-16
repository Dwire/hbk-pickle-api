-- One-time cleanup for a partially applied org/membership migration attempt.
-- Safe to run before re-running 202603150001_org_scoped_memberships/migration.sql.

ALTER TABLE IF EXISTS "League" DROP CONSTRAINT IF EXISTS "League_organizationId_fkey";
ALTER TABLE IF EXISTS "League" DROP COLUMN IF EXISTS "organizationId";

DROP INDEX IF EXISTS "League_one_active_per_org_idx";
DROP INDEX IF EXISTS "League_organizationId_status_idx";

DROP TABLE IF EXISTS "LeagueMembership" CASCADE;
DROP TABLE IF EXISTS "OrganizationMembership" CASCADE;
DROP TABLE IF EXISTS "Organization" CASCADE;

DROP TYPE IF EXISTS "LeagueMembershipStatus";
DROP TYPE IF EXISTS "OrganizationMembershipRole";
