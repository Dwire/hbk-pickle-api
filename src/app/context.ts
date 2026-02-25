import type { Request } from 'express'

import { config } from '../shared/config.js'
import { logger } from '../shared/logger.js'
import { prisma } from '../shared/prisma.js'

export type RequestContext = {
  requestId: string
  authToken: string | null
  userId: string | null
}

export type AppContext = {
  config: typeof config
  logger: typeof logger
  prisma: typeof prisma
  request: RequestContext
}

const authHeaderPrefix = 'Bearer '

const getAuthToken = (request: Request): string | null => {
  const header = request.headers.authorization

  if (!header) {
    return null
  }

  if (!header.startsWith(authHeaderPrefix)) {
    return null
  }

  return header.slice(authHeaderPrefix.length).trim() || null
}

export const buildContext = (request: Request): AppContext => {
  const requestId = request.headers['x-request-id']?.toString() ?? crypto.randomUUID()
  const authToken = getAuthToken(request)

  return {
    config,
    logger,
    prisma,
    request: {
      requestId,
      authToken,
      userId: null
    }
  }
}
