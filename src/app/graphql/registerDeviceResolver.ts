import { createHash } from 'node:crypto'

import type { AppContext } from '../context.js'
import { requireAuth } from '../auth.js'

const registerDeviceLogMessage = 'Registered device token'
const registerDeviceErrorLogMessage = 'Register device failed'
const tokenHashPrefixLength = 12

export type RegisterDeviceArgs = {
  token: string
  platform: string
}

export const hashPushTokenForLogs = (token: string): string => {
  return createHash('sha256')
    .update(token)
    .digest('hex')
    .slice(0, tokenHashPrefixLength)
}

export const registerDeviceResolver = async (
  _: unknown,
  args: RegisterDeviceArgs,
  context: AppContext
) => {
  const userId = requireAuth(context)
  const tokenHashPrefix = hashPushTokenForLogs(args.token)

  try {
    const existingDevice = await context.prisma.userDevice.findUnique({
      where: { token: args.token },
      select: { userId: true }
    })

    const outcome =
      existingDevice == null
        ? 'created'
        : existingDevice.userId === userId
          ? 'updated'
          : 'reassigned'

    await context.prisma.userDevice.upsert({
      where: { token: args.token },
      create: { token: args.token, platform: args.platform, userId },
      update: { platform: args.platform, userId }
    })

    context.logger.info(
      {
        userId,
        platform: args.platform,
        tokenHashPrefix,
        outcome
      },
      registerDeviceLogMessage
    )
    return true
  } catch (error) {
    context.logger.error(
      {
        error,
        userId,
        platform: args.platform,
        tokenHashPrefix
      },
      registerDeviceErrorLogMessage
    )
    throw error
  }
}
