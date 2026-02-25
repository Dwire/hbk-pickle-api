import jwt from 'jsonwebtoken'

import type { AppContext } from './context.js'

type TokenPayload = {
  userId: string
}

const authTokenMissingMessage = 'Missing auth token'

export const requireAuth = (context: AppContext): string => {
  const token = context.request.authToken

  if (!token) {
    throw new Error(authTokenMissingMessage)
  }

  const payload = jwt.verify(token, context.config.auth.jwtSecret) as TokenPayload

  return payload.userId
}
