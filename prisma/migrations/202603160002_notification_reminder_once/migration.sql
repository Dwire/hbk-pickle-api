WITH ranked_reminders AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "occurrenceId", "kind"
      ORDER BY
        CASE
          WHEN "status" = 'SENT' THEN 0
          WHEN "status" = 'FAILED' THEN 1
          ELSE 2
        END ASC,
        "createdAt" DESC,
        "id" DESC
    ) AS row_num
  FROM "Notification"
  WHERE "occurrenceId" IS NOT NULL
    AND "kind" IN ('REGISTRATION_CLOSE_WARNING', 'SESSION_START_WARNING')
)
DELETE FROM "Notification" AS notification
USING ranked_reminders
WHERE notification."id" = ranked_reminders."id"
  AND ranked_reminders.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_reminder_once_idx"
ON "Notification" ("userId", "occurrenceId", "kind")
WHERE "occurrenceId" IS NOT NULL
  AND "kind" IN ('REGISTRATION_CLOSE_WARNING', 'SESSION_START_WARNING');
