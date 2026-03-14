-- Admin league detail performance indexes
CREATE INDEX "Session_leagueId_status_idx" ON "Session"("leagueId", "status");
CREATE INDEX "SessionOccurrence_sessionId_startsAt_status_idx" ON "SessionOccurrence"("sessionId", "startsAt", "status");
CREATE INDEX "SlotAssignment_sessionId_idx" ON "SlotAssignment"("sessionId");
CREATE INDEX "SessionRegistration_occurrenceId_status_idx" ON "SessionRegistration"("occurrenceId", "status");
CREATE INDEX "SubSignup_occurrenceId_status_signedUpAt_idx" ON "SubSignup"("occurrenceId", "status", "signedUpAt");
