import { config } from '../../shared/config.js'

type CloudflareError = {
  code: number
  message: string
}

type CloudflareApiResponse<T> = {
  success: boolean
  errors: CloudflareError[]
  result: T
}

type DirectUploadResult = {
  id: string
  uploadURL: string
}

type CloudflareImageResult = {
  id: string
  meta?: Record<string, string>
  metadata?: Record<string, string>
}

const cloudflareApiBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}`

const toCloudflareErrorMessage = (errors: CloudflareError[]): string => {
  if (errors.length === 0) {
    return 'Cloudflare request failed'
  }

  return errors.map((error) => `[${error.code}] ${error.message}`).join(' | ')
}

export type CreatedDirectUpload = {
  imageId: string
  uploadUrl: string
  expiresAt: Date
}

export type CloudflareImageDetails = {
  imageId: string
  metadata: Record<string, string>
}

export class CloudflareImagesClient {
  private async request<T>(
    path: string,
    init: NonNullable<Parameters<typeof globalThis.fetch>[1]>
  ): Promise<T> {
    const response = await globalThis.fetch(`${cloudflareApiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.cloudflare.imagesApiToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {})
      }
    })

    if (!response.ok) {
      throw new Error(
        `Cloudflare request failed (${response.status} ${response.statusText})`
      )
    }

    const payload = (await response.json()) as CloudflareApiResponse<T>
    if (!payload.success) {
      throw new Error(toCloudflareErrorMessage(payload.errors))
    }

    return payload.result
  }

  public async createDirectUpload(ownerUserId: string): Promise<CreatedDirectUpload> {
    const expiresAt = new Date(
      Date.now() + config.cloudflare.uploadExpirySeconds * 1000
    )
    const result = await this.request<DirectUploadResult>('/images/v2/direct_upload', {
      method: 'POST',
      body: JSON.stringify({
        expiry: expiresAt.toISOString(),
        metadata: {
          ownerUserId
        }
      })
    })

    return {
      imageId: result.id,
      uploadUrl: result.uploadURL,
      expiresAt
    }
  }

  public async getImageDetails(imageId: string): Promise<CloudflareImageDetails> {
    const result = await this.request<CloudflareImageResult>(
      `/images/v1/${imageId}`,
      {
        method: 'GET'
      }
    )
    return {
      imageId: result.id,
      metadata: result.meta ?? result.metadata ?? {}
    }
  }

  public async deleteImage(imageId: string): Promise<void> {
    await this.request<{ id: string }>(`/images/v1/${imageId}`, {
      method: 'DELETE'
    })
  }
}
