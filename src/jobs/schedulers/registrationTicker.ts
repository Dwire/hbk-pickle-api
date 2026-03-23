import { setTimeout as sleepTimeout } from 'node:timers/promises'

import { config } from '../../shared/config.js'
import { logger } from '../../shared/logger.js'

import { runRegistrationTick } from './runRegistrationTick.js'

const schedulerTickSeconds = config.scheduler.tickSeconds
const millisecondsPerSecond = 1000
const schedulerTickMilliseconds = schedulerTickSeconds * millisecondsPerSecond
const schedulerLoopStartedMessage = 'Scheduler loop started'
const schedulerTickCompletedMessage = 'Scheduler tick complete'
const schedulerTickFailedMessage = 'Scheduler tick failed'
const schedulerLoopCrashedMessage = 'Scheduler loop crashed'

const sleep = async (milliseconds: number): Promise<void> =>
  sleepTimeout(milliseconds).then(() => undefined)

const runSchedulerLoop = async (): Promise<void> => {
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

runSchedulerLoop().catch((error) => {
  logger.error({ err: error }, schedulerLoopCrashedMessage)
  process.exit(1)
})
