import { Redis } from 'ioredis'

import { config } from '../../shared/config.js'
import { logger } from '../../shared/logger.js'

const redisClient = new Redis(config.redisUrl)

redisClient.on('connect', () => {
  logger.info('Redis connected')
})

redisClient.on('error', (error: Error) => {
  logger.error({ error }, 'Redis error')
})

export const redis = redisClient
