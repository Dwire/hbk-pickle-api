ALTER TABLE "User"
  ADD COLUMN "profileImageId" TEXT;

CREATE UNIQUE INDEX "User_profileImageId_key"
  ON "User"("profileImageId");

CREATE TABLE "ProfilePhotoUploadIntent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "providerImageId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProfilePhotoUploadIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfilePhotoUploadIntent_providerImageId_key"
  ON "ProfilePhotoUploadIntent"("providerImageId");

CREATE INDEX "ProfilePhotoUploadIntent_userId_usedAt_expiresAt_idx"
  ON "ProfilePhotoUploadIntent"("userId", "usedAt", "expiresAt");

ALTER TABLE "ProfilePhotoUploadIntent"
  ADD CONSTRAINT "ProfilePhotoUploadIntent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
