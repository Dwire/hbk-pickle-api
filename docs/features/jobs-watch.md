# Jobs Watch Command

## Purpose

- Document local commands for production-style jobs execution and readable multi-process job monitoring.

## Core API

- `just jobs`: Runs the production-style combined jobs process locally.
- `just jobs-watch`: Runs both workers and executes `scheduler-tick` every 30 seconds.
- `just jobs-watch <tick_seconds>`: Same flow with a custom tick interval.
- `scheduler-tick` includes reminder queueing, demo-org autofill, sub-selection queueing, and stale profile-photo upload-intent cleanup.

## Key Files

- justfile: `jobs-watch` orchestration command.
- src/jobs/jobsProcess.ts: Combined production jobs entrypoint.
- src/jobs/notificationWorker.ts: Notification queue consumer.
- src/jobs/subSelectionWorker.ts: Sub-selection queue consumer.
- src/jobs/schedulers/registrationTick.ts: Scheduler tick entrypoint.
- src/jobs/schedulers/registrationTicker.ts: Importable scheduler loop used by the combined jobs process.

## Data Flow

### `just jobs`

- `just jobs` mirrors production by starting both BullMQ workers and the scheduler loop in one Node process.
- The process logs notification worker, sub-selection worker, and scheduler failures with source-specific messages.

### `just jobs-watch`

- Starts `worker-notifications` and `worker-sub-selection` concurrently.
- Runs `scheduler-tick` in a loop using the configured interval.
- Every tick includes demo-org active-league autofill during open registration windows.
- Prefixes each process output with a source label so mixed logs remain traceable in one terminal.
- Watches all child process PIDs and exits immediately when the first child process stops, returning that process exit status.
- On first child exit, shuts down the remaining child processes and reaps them before exit.
- Leaves static type validation to `just typecheck` so job loops start without extra startup flags.
- On Ctrl+C or TERM, exits with signal code and stops all spawned processes without unbound-variable cleanup failures.
