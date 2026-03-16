import jwt from 'jsonwebtoken'
import type { Request } from 'express'

import { config } from '../shared/config.js'
import { logger } from '../shared/logger.js'
import { prisma } from '../shared/prisma.js'

export type RequestContext = {
  requestId: string
  authToken: string | null
  userId: string | null
  authzCache: {
    hasVerifiedUser: boolean
    orgAdminByOrgId: Map<string, boolean>
    orgIdByLeagueId: Map<string, string>
    leagueIdBySessionId: Map<string, string>
    leagueIdByOccurrenceId: Map<string, string>
    leagueIdBySlotAssignmentId: Map<string, string>
    leagueAccessByLeagueId: Map<string, boolean>
  }
}

export type AppContext = {
  config: typeof config
  logger: typeof logger
  prisma: typeof prisma
  request: RequestContext
}

type TokenPayload = {
  userId: string
}

const authHeaderPrefix = 'Bearer '
const invalidAuthTokenMessage = 'Invalid auth token'

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
  let userId: string | null = null

  if (authToken) {
    try {
      const payload = jwt.verify(authToken, config.auth.jwtSecret) as TokenPayload
      userId = payload.userId
    } catch (error) {
      logger.warn({ error }, invalidAuthTokenMessage)
    }
  }

  return {
    config,
    logger,
    prisma,
    request: {
      requestId,
      authToken,
      userId,
      authzCache: {
        hasVerifiedUser: false,
        orgAdminByOrgId: new Map<string, boolean>(),
        orgIdByLeagueId: new Map<string, string>(),
        leagueIdBySessionId: new Map<string, string>(),
        leagueIdByOccurrenceId: new Map<string, string>(),
        leagueIdBySlotAssignmentId: new Map<string, string>(),
        leagueAccessByLeagueId: new Map<string, boolean>()
      }
    }
  }
}
