# Notifications Feature

## Purpose

- Queue and deliver push notifications for registration windows and session reminders.

## Core API

- Register device tokens for push delivery.

## Key Files

- src/integrations/firebase/firebaseClient.ts: Firebase Cloud Messaging client.
- src/integrations/bull/queue.ts: BullMQ queue setup.
- src/jobs/notificationWorker.ts: Worker for push delivery.
- src/jobs/schedulers/registrationScheduler.ts: Registration/session reminder scheduling.
- src/jobs/schedulers/registrationTick.ts: Scheduler entrypoint.
- src/app/graphql/schema.ts: Device registration mutation.

## Data Flow

- Device tokens stored for users.
- Jobs queued for push notifications and delivered via FCM.
