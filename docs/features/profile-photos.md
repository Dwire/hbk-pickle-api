# Profile Photos

## Summary

- Supports authenticated profile photo upload/replace/delete flows via Cloudflare Images direct uploads.
- Keeps binary upload traffic off the API by issuing short-lived upload intents and finalizing ownership in GraphQL.
- Creates direct-upload intents with multipart form payloads (Cloudflare `/images/v2/direct_upload` media type requirement).
- Sets Cloudflare direct-upload `id` values to the `hobo-player-profile-<unique>` pattern so stored provider image ids stay app-scoped.
- Resolves `User.profileImageUrl` from provider image id + configured avatar delivery variant.
- Performs stale upload-intent cleanup in scheduler ticks and attempts orphan image deletion at the provider.

## API Surface

- Field: `User.profileImageUrl: String`
- Member mutations:
  - `createMyProfilePhotoUploadIntent: ProfilePhotoUploadIntent!`
  - `completeMyProfilePhotoUpload(imageId: ID!): User!`
  - `deleteMyProfilePhoto: User!`
- Admin mutation:
  - `adminDeletePlayerProfilePhoto(organizationId: ID!, playerId: ID!): User!`
- Auth:
  - Member mutations require `requireAuth`
  - Admin delete requires `requireOrgAdminOrOwner`

## Key Files

- `src/features/profilePhoto/profilePhotoService.ts`: Upload intent creation, completion verification, replace/delete logic, and stale-intent cleanup.
- `src/integrations/cloudflare/cloudflareImagesClient.ts`: Cloudflare Images API wrapper for direct upload, image lookup, and delete.
- `src/integrations/cloudflare/profileImageUrl.ts`: Delivery URL resolver using configured hash + avatar variant.
- `src/app/graphql/schema.ts`: GraphQL fields/mutations and resolver wiring.
- `src/jobs/schedulers/registrationScheduler.ts`: Scheduler hook for stale upload-intent cleanup.
- `prisma/schema.prisma`: `User.profileImageId` and `ProfilePhotoUploadIntent` model definitions.
- `prisma/migrations/202603200001_profile_photo_support/migration.sql`: DB migration for profile photo metadata tables/indices.

## Environment

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_IMAGES_API_TOKEN`
- `CLOUDFLARE_IMAGES_DELIVERY_HASH` (optional for bootstrapping; when unset, `User.profileImageUrl` resolves to `null`)
- `CLOUDFLARE_IMAGES_AVATAR_VARIANT` (default `avatar`)
- `CLOUDFLARE_IMAGES_UPLOAD_EXPIRY_SECONDS` (default `900`, max `86400`)
