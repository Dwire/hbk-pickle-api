import { Queue } from 'bullmq'

import { config } from '../../shared/config.js'

const queueName = 'notifications'

export const notificationQueue = new Queue(queueName, {
  connection: {
    url: config.redisUrl
  }
})
