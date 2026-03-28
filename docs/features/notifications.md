# Notifications Feature

## Purpose

- Queue and deliver push notifications for registration windows and session reminders.
- Notify sub players when selection state changes during the post-registration window.
- Notify assigned players when a session occurrence is canceled.
- Run scheduler-time demo-org autofill before sub-selection queueing so demo sessions auto-populate during open registration windows.

## Core API

- Register device tokens for push delivery.

## Key Files

- src/integrations/firebase/firebaseClient.ts: Firebase Cloud Messaging client.
- src/integrations/bull/queue.ts: BullMQ queue setup (notifications + sub-selection).
- src/jobs/notificationWorker.ts: Worker for push delivery.
- src/jobs/subSelectionWorker.ts: Worker for sub selection processing and sub notification enqueueing.
- src/jobs/schedulers/registrationScheduler.ts: Registration/session reminder scheduling.
- src/jobs/schedulers/demoOrgAutofillService.ts: Demo-org scoped registration/sub autofill during open registration windows.
- src/jobs/schedulers/registrationTick.ts: Scheduler entrypoint.
- prisma/migrations/202603160002_notification_reminder_once/migration.sql: Dedupes historical reminder rows and adds once-only reminder unique index.
- src/features/sessions/sessionService.ts: Admin cancellation flow that creates and enqueues `SESSION_CANCELED` notifications.
- src/app/graphql/schema.ts: Device registration mutation.

## Data Flow

- Device tokens stored for users.
- Scheduler tick runs demo-org autofill against open occurrences in active demo-org leagues before sub-selection queueing.
- Demo registration autofill only runs when an occurrence has zero `ATTENDING` registrations and fills to a randomized 50%-80% target using assigned users.
- Demo sub autofill adds at most one sub per tick per occurrence and caps each occurrence at 8 `ACTIVE` + `SELECTED` subs.
- Scheduler tick enqueues one sub-selection job per eligible occurrence (`ACTIVE`, registration closed, and not ended).
- Scheduler tick skips enqueueing when an occurrence already has an in-flight sub-selection job id, preventing duplicate-job enqueue failures in repeated ticks.
- Reminder scheduler only queues registration-close/session-start warnings when warning time is reached (`warningAt <= now`).
- Reminder scheduler batches due occurrences, attending users, and user devices to avoid per-occurrence query fanout.
- Reminder scheduler enforces once-only reminder semantics per `(userId, occurrenceId, kind)`, reuses existing `PENDING` reminder rows when enqueue is retried, and queues reminder jobs with deterministic notification-based job ids.
- Sub-selection worker revalidates eligibility, runs selection, and queues `SUB_SELECTED` for newly selected users and `SUB_STATUS_CHANGED` for users who are no longer selected.
- Admin occurrence cancellation creates at most one `SESSION_CANCELED` notification per user/occurrence and enqueues notification jobs only for users with registered device tokens.
- Notifications worker delivers queued push jobs via FCM.
