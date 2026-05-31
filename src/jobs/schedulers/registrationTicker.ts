import { setTimeout as sleepTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

import { config } from '../../shared/config.js'
import { logger } from '../../shared/logger.js'

import { runRegistrationTick } from './runRegistrationTick.js'

const millisecondsPerSecond = 1000
const schedulerLoopStartedMessage = 'Scheduler loop started'
const schedulerTickCompletedMessage = 'Scheduler tick complete'
const schedulerTickFailedMessage = 'Scheduler tick failed'
const schedulerLoopCrashedMessage = 'Scheduler loop crashed'

const sleep = async (milliseconds: number): Promise<void> =>
  sleepTimeout(milliseconds).then(() => undefined)

/**
 * Runs scheduler ticks forever for production background execution.
 */
export const runSchedulerLoop = async (): Promise<void> => {
  const schedulerTickSeconds = config.scheduler.tickSeconds
  const schedulerTickMilliseconds = schedulerTickSeconds * millisecondsPerSecond

  logger.info({ tickSeconds: schedulerTickSeconds }, schedulerLoopStartedMessage)

  while (true) {
    const startedAt = new Date()
    try {
      await runRegistrationTick(startedAt)
      logger.info({ startedAt, tickSeconds: schedulerTickSeconds }, schedulerTickCompletedMessage)
    } catch (error) {
      logger.error({ err: error, startedAt, tickSeconds: schedulerTickSeconds }, schedulerTickFailedMessage)
    }

    await sleep(schedulerTickMilliseconds)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSchedulerLoop().catch((error) => {
    logger.error({ err: error }, schedulerLoopCrashedMessage)
    process.exit(1)
  })
}
