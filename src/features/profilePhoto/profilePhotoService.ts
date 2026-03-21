import type { User } from '../../generated/prisma/client.js'
import { logger } from '../../shared/logger.js'
import { prisma } from '../../shared/prisma.js'
import { CloudflareImagesClient } from '../../integrations/cloudflare/cloudflareImagesClient.js'

const errorUserMissing = 'User missing'
const errorUploadIntentMissing = 'Profile photo upload intent missing'
const errorUploadIntentForbidden = 'Upload intent does not belong to user'
const errorUploadIntentAlreadyUsed = 'Upload intent already used'
const errorUploadIntentExpired = 'Upload intent expired'
const errorUploadOwnershipMismatch = 'Uploaded image ownership mismatch'
const errorPlayerNotInOrganization = 'Player not in organization'
const metadataOwnerUserIdKey = 'ownerUserId'
const staleIntentCleanupBatchSize = 100

export type ProfilePhotoUploadIntentResult = {
  imageId: string
  uploadUrl: string
  expiresAt: Date
}

type CleanupSummary = {
  staleIntentCount: number
  deletedIntentCount: number
  attemptedCloudflareDeleteCount: number
  cloudflareDeleteFailureCount: number
}

export class ProfilePhotoService {
  private cloudflareImagesClient = new CloudflareImagesClient()

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    })

    if (!user) {
      throw new Error(errorUserMissing)
    }
  }

  private async clearProfilePhotoForUser(userId: string): Promise<User> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    })
    if (!user) {
      throw new Error(errorUserMissing)
    }

    const previousImageId = user.profileImageId
    const updatedUser =
      previousImageId === null
        ? user
        : await prisma.user.update({
            where: { id: userId },
            data: {
              profileImageId: null
            }
          })

    if (previousImageId) {
      try {
        await this.cloudflareImagesClient.deleteImage(previousImageId)
      } catch (error) {
        logger.warn(
          { userId, imageId: previousImageId, err: error },
          'Failed to delete Cloudflare profile image during clear'
        )
      }
    }

    return updatedUser
  }

  public async createUploadIntent(
    userId: string
  ): Promise<ProfilePhotoUploadIntentResult> {
    await this.ensureUserExists(userId)

    const createdUpload = await this.cloudflareImagesClient.createDirectUpload(userId)

    await prisma.profilePhotoUploadIntent.create({
      data: {
        userId,
        providerImageId: createdUpload.imageId,
        expiresAt: createdUpload.expiresAt
      }
    })

    return createdUpload
  }

  public async completeUpload(userId: string, imageId: string): Promise<User> {
    const normalizedImageId = imageId.trim()
    const now = new Date()

    const uploadIntent = await prisma.profilePhotoUploadIntent.findUnique({
      where: {
        providerImageId: normalizedImageId
      }
    })

    if (!uploadIntent) {
      throw new Error(errorUploadIntentMissing)
    }
    if (uploadIntent.userId !== userId) {
      throw new Error(errorUploadIntentForbidden)
    }
    if (uploadIntent.usedAt) {
      throw new Error(errorUploadIntentAlreadyUsed)
    }
    if (uploadIntent.expiresAt <= now) {
      throw new Error(errorUploadIntentExpired)
    }

    const imageDetails = await this.cloudflareImagesClient.getImageDetails(
      normalizedImageId
    )
    const metadataOwnerUserId = imageDetails.metadata[metadataOwnerUserIdKey]
    if (metadataOwnerUserId && metadataOwnerUserId !== userId) {
      throw new Error(errorUploadOwnershipMismatch)
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, profileImageId: true }
    })
    if (!existingUser) {
      throw new Error(errorUserMissing)
    }

    const previousImageId = existingUser.profileImageId
    const updatedUser = await prisma.$transaction(async (tx) => {
      await tx.profilePhotoUploadIntent.update({
        where: {
          providerImageId: normalizedImageId
        },
        data: {
          usedAt: now
        }
      })

      return tx.user.update({
        where: {
          id: userId
        },
        data: {
          profileImageId: normalizedImageId
        }
      })
    })

    if (previousImageId && previousImageId !== normalizedImageId) {
      try {
        await this.cloudflareImagesClient.deleteImage(previousImageId)
      } catch (error) {
        logger.warn(
          { userId, imageId: previousImageId, err: error },
          'Failed to delete replaced Cloudflare profile image'
        )
      }
    }

    return updatedUser
  }

  public async deleteMyProfilePhoto(userId: string): Promise<User> {
    return this.clearProfilePhotoForUser(userId)
  }

  public async adminDeletePlayerProfilePhoto(
    organizationId: string,
    playerId: string
  ): Promise<User> {
    const playerInOrganization = await prisma.user.findFirst({
      where: {
        id: playerId,
        OR: [
          {
            organizationMemberships: {
              some: {
                organizationId
              }
            }
          },
          {
            leagueMemberships: {
              some: {
                league: {
                  organizationId
                }
              }
            }
          }
        ]
      },
      select: { id: true }
    })

    if (!playerInOrganization) {
      throw new Error(errorPlayerNotInOrganization)
    }

    return this.clearProfilePhotoForUser(playerId)
  }

  public async cleanupStaleUploadIntents(now: Date): Promise<CleanupSummary> {
    const staleIntents = await prisma.profilePhotoUploadIntent.findMany({
      where: {
        usedAt: null,
        expiresAt: {
          lte: now
        }
      },
      orderBy: {
        expiresAt: 'asc'
      },
      take: staleIntentCleanupBatchSize
    })

    if (staleIntents.length === 0) {
      return {
        staleIntentCount: 0,
        deletedIntentCount: 0,
        attemptedCloudflareDeleteCount: 0,
        cloudflareDeleteFailureCount: 0
      }
    }

    let attemptedCloudflareDeleteCount = 0
    let cloudflareDeleteFailureCount = 0

    for (const intent of staleIntents) {
      attemptedCloudflareDeleteCount += 1
      try {
        await this.cloudflareImagesClient.deleteImage(intent.providerImageId)
      } catch (error) {
        cloudflareDeleteFailureCount += 1
        logger.warn(
          {
            uploadIntentId: intent.id,
            imageId: intent.providerImageId,
            err: error
          },
          'Failed to delete stale Cloudflare image'
        )
      }
    }

    const staleIntentIds = staleIntents.map((intent) => intent.id)
    const deletedIntents = await prisma.profilePhotoUploadIntent.deleteMany({
      where: {
        id: {
          in: staleIntentIds
        }
      }
    })

    return {
      staleIntentCount: staleIntents.length,
      deletedIntentCount: deletedIntents.count,
      attemptedCloudflareDeleteCount,
      cloudflareDeleteFailureCount
    }
  }
}
