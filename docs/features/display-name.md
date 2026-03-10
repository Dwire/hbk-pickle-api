# Display Name

## Summary

- Allows an authenticated user to upsert their displayName via GraphQL.
- Persists updates through the user profile service with Prisma-backed storage.
- Logs each update attempt and completion for operational visibility.

## API Surface

- Mutation: updateDisplayName(displayName: String!): User!
- Auth: requires a valid bearer token (requireAuth)

## Files

- src/features/users/userService.ts: Upserts user displayName with Prisma and structured logging.
- src/app/graphql/schema.ts: GraphQL mutation definition and resolver wiring using requireAuth.
