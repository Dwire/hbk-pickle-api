import type { User } from '../../generated/prisma/client.js'
import { logger } from '../../shared/logger.js'
import { prisma } from '../../shared/prisma.js'

const logUpsertingDisplayName = 'Upserting user display name'
const logUpsertedDisplayName = 'Upserted user display name'
const messageUserMissingForDisplayName = 'User missing for display name update'

/**
 * UserService
 * - Updates user profile fields like displayName.
 * - Persists changes through Prisma's user model.
 * - Used by authenticated GraphQL profile mutations.
 */
export class UserService {
  /**
   * Upserts the display name for the authenticated user.
   */
  public async upsertDisplayName(userId: string, displayName: string): Promise<User> {
    logger.info({ userId, displayName }, logUpsertingDisplayName)
    const existingUser = await prisma.user.findUnique({ where: { id: userId } })

    if (!existingUser) {
      logger.warn({ userId }, messageUserMissingForDisplayName)
      throw new Error(messageUserMissingForDisplayName)
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { displayName }
    })

    logger.info({ userId, displayName, updatedAt: updatedUser.updatedAt }, logUpsertedDisplayName)
    return updatedUser
  }
}
