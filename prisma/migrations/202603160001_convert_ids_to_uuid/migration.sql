BEGIN;

ALTER TABLE "UserDevice" DROP CONSTRAINT IF EXISTS "UserDevice_userId_fkey";
ALTER TABLE "League" DROP CONSTRAINT IF EXISTS "League_organizationId_fkey";
ALTER TABLE "OrganizationMembership" DROP CONSTRAINT IF EXISTS "OrganizationMembership_organizationId_fkey";
ALTER TABLE "OrganizationMembership" DROP CONSTRAINT IF EXISTS "OrganizationMembership_userId_fkey";
ALTER TABLE "LeagueMembership" DROP CONSTRAINT IF EXISTS "LeagueMembership_leagueId_fkey";
ALTER TABLE "LeagueMembership" DROP CONSTRAINT IF EXISTS "LeagueMembership_userId_fkey";
ALTER TABLE "LeagueRule" DROP CONSTRAINT IF EXISTS "LeagueRule_leagueId_fkey";
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_leagueId_fkey";
ALTER TABLE "SessionOccurrence" DROP CONSTRAINT IF EXISTS "SessionOccurrence_sessionId_fkey";
ALTER TABLE "SlotAssignment" DROP CONSTRAINT IF EXISTS "SlotAssignment_leagueId_fkey";
ALTER TABLE "SlotAssignment" DROP CONSTRAINT IF EXISTS "SlotAssignment_userId_fkey";
ALTER TABLE "SlotAssignment" DROP CONSTRAINT IF EXISTS "SlotAssignment_sessionId_fkey";
ALTER TABLE "SessionRegistration" DROP CONSTRAINT IF EXISTS "SessionRegistration_userId_fkey";
ALTER TABLE "SessionRegistration" DROP CONSTRAINT IF EXISTS "SessionRegistration_occurrenceId_fkey";
ALTER TABLE "SubSignup" DROP CONSTRAINT IF EXISTS "SubSignup_userId_fkey";
ALTER TABLE "SubSignup" DROP CONSTRAINT IF EXISTS "SubSignup_occurrenceId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_userId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_occurrenceId_fkey";

ALTER TABLE "User" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "Organization" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Organization" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "League" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "League" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "League" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;

ALTER TABLE "UserDevice" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "UserDevice" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "UserDevice" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;

ALTER TABLE "OrganizationMembership" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "OrganizationMembership" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "OrganizationMembership" ALTER COLUMN "organizationId" TYPE UUID USING "organizationId"::uuid;
ALTER TABLE "OrganizationMembership" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;

ALTER TABLE "LeagueMembership" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "LeagueMembership" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "LeagueMembership" ALTER COLUMN "leagueId" TYPE UUID USING "leagueId"::uuid;
ALTER TABLE "LeagueMembership" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;

ALTER TABLE "LeagueRule" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "LeagueRule" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "LeagueRule" ALTER COLUMN "leagueId" TYPE UUID USING "leagueId"::uuid;

ALTER TABLE "Session" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Session" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Session" ALTER COLUMN "leagueId" TYPE UUID USING "leagueId"::uuid;

ALTER TABLE "SessionOccurrence" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "SessionOccurrence" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "SessionOccurrence" ALTER COLUMN "sessionId" TYPE UUID USING "sessionId"::uuid;

ALTER TABLE "SlotAssignment" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "SlotAssignment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "SlotAssignment" ALTER COLUMN "leagueId" TYPE UUID USING "leagueId"::uuid;
ALTER TABLE "SlotAssignment" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "SlotAssignment" ALTER COLUMN "sessionId" TYPE UUID USING "sessionId"::uuid;

ALTER TABLE "SessionRegistration" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "SessionRegistration" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "SessionRegistration" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "SessionRegistration" ALTER COLUMN "occurrenceId" TYPE UUID USING "occurrenceId"::uuid;

ALTER TABLE "SubSignup" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "SubSignup" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "SubSignup" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "SubSignup" ALTER COLUMN "occurrenceId" TYPE UUID USING "occurrenceId"::uuid;

ALTER TABLE "Notification" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Notification" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "Notification" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;
ALTER TABLE "Notification" ALTER COLUMN "occurrenceId" TYPE UUID USING "occurrenceId"::uuid;

ALTER TABLE "UserDevice"
  ADD CONSTRAINT "UserDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "League"
  ADD CONSTRAINT "League_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

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

ALTER TABLE "LeagueRule"
  ADD CONSTRAINT "LeagueRule_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "League"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "League"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SessionOccurrence"
  ADD CONSTRAINT "SessionOccurrence_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SlotAssignment"
  ADD CONSTRAINT "SlotAssignment_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "League"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SlotAssignment"
  ADD CONSTRAINT "SlotAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SlotAssignment"
  ADD CONSTRAINT "SlotAssignment_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SessionRegistration"
  ADD CONSTRAINT "SessionRegistration_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SessionRegistration"
  ADD CONSTRAINT "SessionRegistration_occurrenceId_fkey"
  FOREIGN KEY ("occurrenceId") REFERENCES "SessionOccurrence"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubSignup"
  ADD CONSTRAINT "SubSignup_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubSignup"
  ADD CONSTRAINT "SubSignup_occurrenceId_fkey"
  FOREIGN KEY ("occurrenceId") REFERENCES "SessionOccurrence"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_occurrenceId_fkey"
  FOREIGN KEY ("occurrenceId") REFERENCES "SessionOccurrence"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
