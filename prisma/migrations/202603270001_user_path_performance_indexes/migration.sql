-- User-centric performance indexes for registration, sub signup, and assignment checks
CREATE INDEX "SlotAssignment_userId_sessionId_idx"
  ON "SlotAssignment"("userId", "sessionId");

CREATE INDEX "SessionRegistration_userId_status_idx"
  ON "SessionRegistration"("userId", "status");

CREATE INDEX "SubSignup_userId_status_idx"
  ON "SubSignup"("userId", "status");
