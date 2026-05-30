import './notificationWorker.js'
import './subSelectionWorker.js'

import { logger } from '../shared/logger.js'

import { runSchedulerLoop } from './schedulers/registrationTicker.js'

const jobsProcessCrashedMessage = 'Jobs process crashed'

runSchedulerLoop().catch((error) => {
  logger.error({ err: error }, jobsProcessCrashedMessage)
  process.exit(1)
})
