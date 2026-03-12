import { Queue } from 'bullmq'

import { config } from '../../shared/config.js'

const notificationsQueueName = 'notifications'
const subSelectionQueueName = 'sub-selection'

const queueConnection = {
  url: config.redisUrl
}

export const notificationQueue = new Queue(notificationsQueueName, {
  connection: queueConnection
})

export const subSelectionQueue = new Queue(subSelectionQueueName, {
  connection: queueConnection
})
