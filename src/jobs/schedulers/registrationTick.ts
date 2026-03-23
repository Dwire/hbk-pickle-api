import { logger } from '../../shared/logger.js'

import { runRegistrationTick } from './runRegistrationTick.js'

runRegistrationTick(new Date())
  .then(() => {
    logger.info('Scheduler tick complete')
    process.exit(0)
  })
  .catch((error) => {
    logger.error({ err: error }, 'Scheduler tick failed')
    process.exit(1)
  })
