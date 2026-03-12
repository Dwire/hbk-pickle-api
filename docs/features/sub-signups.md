# Sub Signup Feature

## Purpose

- Allow players to offer as substitutes for weekly occurrences, including those assigned to the session.
- Keep sub signup availability open until the session occurrence ends (Eastern rules applied to UTC instants).

## Core API

- Signup as sub for a session occurrence.
- Cancel sub signup for an occurrence.

## Key Files

- src/features/subs/subSignupService.ts: Occurrence-based sub signup logic.
- src/app/graphql/schema.ts: Sub signup mutations (occurrence-scoped).

## Data Flow

- Create or reactivate one sub signup record per occurrence with ACTIVE or CANCELED status transitions.
- Enforce sub signup window using SessionService.isWithinSubSignupWindow(now, occurrence.endsAt).
- Allow sub signups regardless of assignment; enforce same-day attendance and same-day sub constraints.
- Store sub queue position with `signedUpAt`; re-signing after cancel resets `signedUpAt` so players move to the end.
- After registration closes, scheduler ticks enqueue sub-selection jobs through session end so ACTIVE signups can move into SELECTED as the list changes.
- Sub-selection worker performs the selection calculation and sends selection state-change notifications.
- Session summaries count only ACTIVE sub signups; canceled/selected/replaced do not contribute to subCount.
