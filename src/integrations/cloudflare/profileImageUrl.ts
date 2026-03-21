import { config } from '../../shared/config.js'

const cloudflareImagesDeliveryHash = config.cloudflare.imagesDeliveryHash?.trim()

const buildProfileImageUrl = (deliveryHash: string, imageId: string): string =>
  `https://imagedelivery.net/${deliveryHash}/${imageId}/${config.cloudflare.avatarVariant}`

export const resolveProfileImageUrl = (
  imageId: string | null | undefined
): string | null => {
  if (!cloudflareImagesDeliveryHash) {
    return null
  }

  const trimmedImageId = imageId?.trim()
  if (!trimmedImageId) {
    return null
  }

  return buildProfileImageUrl(cloudflareImagesDeliveryHash, trimmedImageId)
}
