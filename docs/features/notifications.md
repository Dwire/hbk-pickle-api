# Notifications Feature

## Purpose

- Queue and deliver push notifications for registration windows and session reminders.
- Notify sub players when selection state changes during the post-registration window.

## Core API

- Register device tokens for push delivery.

## Key Files

- src/integrations/firebase/firebaseClient.ts: Firebase Cloud Messaging client.
- src/integrations/bull/queue.ts: BullMQ queue setup (notifications + sub-selection).
- src/jobs/notificationWorker.ts: Worker for push delivery.
- src/jobs/subSelectionWorker.ts: Worker for sub selection processing and sub notification enqueueing.
- src/jobs/schedulers/registrationScheduler.ts: Registration/session reminder scheduling.
- src/jobs/schedulers/registrationTick.ts: Scheduler entrypoint.
- src/app/graphql/schema.ts: Device registration mutation.

## Data Flow

- Device tokens stored for users.
- Scheduler tick enqueues one sub-selection job per eligible occurrence (registration closed and occurrence not ended).
- Scheduler tick skips enqueueing when an occurrence already has an in-flight sub-selection job id, preventing duplicate-job enqueue failures in repeated ticks.
- Sub-selection worker revalidates eligibility, runs selection, and queues `SUB_SELECTED` for newly selected users and `SUB_STATUS_CHANGED` for users who are no longer selected.
- Notifications worker delivers queued push jobs via FCM.
