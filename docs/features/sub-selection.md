# Sub Selection Feature

## Purpose

- Select subs after registration closes using deterministic, backend-owned attendance coverage rules.
- Maximize playable capacity by auto-pairing non-overlapping registered partial attendees before sub selection.

## Core API

- No new GraphQL endpoints; behavior is driven by existing registration/sub mutations and scheduler/worker selection recalculation.
- Existing assignment fields remain the contract: `selectionType`, `assignedStartOffsetMinutes`, `assignedEndOffsetMinutes`, `partialLocked`.

## Key Files

- src/features/subs/subSelectionEngine.ts: Pure deterministic selection engine (queue order, mode behavior, selected-sub stability, lock handling).
- src/features/subs/subSelectionService.ts: Persistence + notification orchestration around engine results.
- src/shared/attendanceCoverage.ts: Shared segment math, 15-minute partial validation, deterministic max-cardinality non-overlap pairing, and effective occupancy calculations.
- src/jobs/subSelectionWorker.ts: Queue worker execution and post-selection notification enqueue trigger.

## Data Flow

- Registered attendees are normalized into edge-aligned segments (`START`/`END`) in 15-minute blocks.
- Non-overlapping registered partial attendees are auto-paired only when both segments provide at least 30 minutes (deterministic max-cardinality START/END matching), reducing effective occupied slots before sub selection.
- Pairing objective is currently pair-count only (not dead-time minimization) so weighted/coverage optimization can be added later without changing external APIs.
- Full-slot availability is computed as `capacity - effectiveRegisteredOccupiedSlots`.
- Unpaired registered partial attendees create partial slots that subs can fill only when the available segment is at least 30 minutes.
- Selected locked partial subs are preserved first when their exact segment still exists.
- Remaining selected subs are re-fit before non-selected queue users so selected users remain selected whenever compatible capacity exists.
- Queue assignment behavior:
  - `FULL_ONLY`: full slots only.
  - `FLEX`: full slots first, partial slots second.
  - `PARTIAL_ONLY`: matching partial slots first; if none, consume a full slot as a partial assignment and emit the complementary partial slot for downstream queue users only when that complementary slot is at least 30 minutes.
- Selection recalculation remains backend-driven via post-close mutation-triggered rebalance and scheduler/worker ticks.
