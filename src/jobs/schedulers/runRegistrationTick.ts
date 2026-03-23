import { RegistrationScheduler } from './registrationScheduler.js'

const scheduler = new RegistrationScheduler()

/**
 * Runs one scheduler tick for warnings, sub-selection queueing, and stale-upload cleanup.
 */
export const runRegistrationTick = async (now: Date): Promise<void> => {
  await scheduler.queueRegistrationCloseWarnings(now)
  await scheduler.queueSessionStartWarnings(now)
  await scheduler.queueSubSelection(now)
  await scheduler.cleanupStaleProfilePhotoUploadIntents(now)
}
