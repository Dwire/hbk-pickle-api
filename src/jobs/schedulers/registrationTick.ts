import { logger } from '../../shared/logger.js'

import { RegistrationScheduler } from './registrationScheduler.js'

const scheduler = new RegistrationScheduler()

const tick = async (): Promise<void> => {
  const now = new Date()
  await scheduler.queueRegistrationCloseWarnings(now)
  await scheduler.queueSessionStartWarnings(now)
  await scheduler.queueSubSelection(now)
  await scheduler.cleanupStaleProfilePhotoUploadIntents(now)
}

tick()
  .then(() => {
    logger.info('Scheduler tick complete')
    process.exit(0)
  })
  .catch((error) => {
    logger.error({ err: error }, 'Scheduler tick failed')
    process.exit(1)
  })
