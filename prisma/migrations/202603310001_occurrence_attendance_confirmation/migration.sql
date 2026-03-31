CREATE TABLE "OccurrenceAttendanceConfirmation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "occurrenceId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "confirmedByUserId" UUID,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OccurrenceAttendanceConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OccurrenceAttendanceConfirmation_occurrenceId_userId_key"
  ON "OccurrenceAttendanceConfirmation"("occurrenceId", "userId");

CREATE INDEX "OccurrenceAttendanceConfirmation_occurrenceId_idx"
  ON "OccurrenceAttendanceConfirmation"("occurrenceId");

CREATE INDEX "OccurrenceAttendanceConfirmation_confirmedByUserId_idx"
  ON "OccurrenceAttendanceConfirmation"("confirmedByUserId");

ALTER TABLE "OccurrenceAttendanceConfirmation"
  ADD CONSTRAINT "OccurrenceAttendanceConfirmation_occurrenceId_fkey"
  FOREIGN KEY ("occurrenceId") REFERENCES "SessionOccurrence"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OccurrenceAttendanceConfirmation"
  ADD CONSTRAINT "OccurrenceAttendanceConfirmation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OccurrenceAttendanceConfirmation"
  ADD CONSTRAINT "OccurrenceAttendanceConfirmation_confirmedByUserId_fkey"
  FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
