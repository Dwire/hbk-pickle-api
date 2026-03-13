import jwt from 'jsonwebtoken'

import type { AppContext } from './context.js'

type TokenPayload = {
  userId: string
}

const authTokenMissingMessage = 'Missing auth token'
const userMissingMessage = 'User missing'
const adminRole = 'ADMIN'
const adminRequiredMessage = 'Admin role required'

export const requireAuth = (context: AppContext): string => {
  const token = context.request.authToken

  if (!token) {
    throw new Error(authTokenMissingMessage)
  }

  const payload = jwt.verify(token, context.config.auth.jwtSecret) as TokenPayload

  return payload.userId
}

export const requireAdmin = async (context: AppContext): Promise<string> => {
  const userId = requireAuth(context)
  const user = await context.prisma.user.findUnique({
    where: { id: userId },
    select: { role: true }
  })

  if (!user) {
    throw new Error(userMissingMessage)
  }

  if (user.role !== adminRole) {
    throw new Error(adminRequiredMessage)
  }

  return userId
}
