CREATE TYPE "PlaySegmentSide" AS ENUM ('START', 'END');
CREATE TYPE "RegistrationPlayMode" AS ENUM ('FULL', 'PARTIAL');
CREATE TYPE "SubAvailabilityMode" AS ENUM ('FULL_ONLY', 'FLEX', 'PARTIAL_ONLY');
CREATE TYPE "SubSelectionType" AS ENUM ('FULL', 'PARTIAL');

ALTER TABLE "SessionRegistration"
  ADD COLUMN "playMode" "RegistrationPlayMode" NOT NULL DEFAULT 'FULL',
  ADD COLUMN "playSegmentSide" "PlaySegmentSide",
  ADD COLUMN "playMinutes" INTEGER,
  ADD COLUMN "fillTargetRegistrationId" UUID;

ALTER TABLE "SubSignup"
  ADD COLUMN "availabilityMode" "SubAvailabilityMode" NOT NULL DEFAULT 'FLEX',
  ADD COLUMN "availabilitySegmentSide" "PlaySegmentSide",
  ADD COLUMN "availabilityMinutes" INTEGER,
  ADD COLUMN "selectionType" "SubSelectionType",
  ADD COLUMN "assignedStartOffsetMinutes" INTEGER,
  ADD COLUMN "assignedEndOffsetMinutes" INTEGER,
  ADD COLUMN "partialLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "partialLockedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "SessionRegistration_fillTargetRegistrationId_key"
  ON "SessionRegistration"("fillTargetRegistrationId");

CREATE INDEX "SessionRegistration_occurrenceId_playMode_idx"
  ON "SessionRegistration"("occurrenceId", "playMode");

CREATE INDEX "SubSignup_occurrenceId_selectionType_idx"
  ON "SubSignup"("occurrenceId", "selectionType");

ALTER TABLE "SessionRegistration"
  ADD CONSTRAINT "SessionRegistration_fillTargetRegistrationId_fkey"
  FOREIGN KEY ("fillTargetRegistrationId") REFERENCES "SessionRegistration"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
