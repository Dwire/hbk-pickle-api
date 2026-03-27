-- User-centric performance indexes for registration and sub signup checks
CREATE INDEX "SessionRegistration_userId_status_idx"
  ON "SessionRegistration"("userId", "status");

CREATE INDEX "SubSignup_userId_status_idx"
  ON "SubSignup"("userId", "status");
