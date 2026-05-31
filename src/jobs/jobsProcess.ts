import { logger } from '../shared/logger.js'

import { notificationWorker } from './notificationWorker.js'
import { runSchedulerLoop } from './schedulers/registrationTicker.js'
import { subSelectionWorker } from './subSelectionWorker.js'

const jobsProcessCrashedMessage = 'Jobs process crashed'
const notificationWorkerErrorMessage = 'Notification worker error'
const subSelectionWorkerErrorMessage = 'Sub-selection worker error'

notificationWorker.on('error', (error: Error) => {
  logger.error({ err: error }, notificationWorkerErrorMessage)
})

subSelectionWorker.on('error', (error: Error) => {
  logger.error({ err: error }, subSelectionWorkerErrorMessage)
})

runSchedulerLoop().catch((error) => {
  logger.error({ err: error }, jobsProcessCrashedMessage)
  process.exit(1)
})
