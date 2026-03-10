import jwt from 'jsonwebtoken'

import { twilioClient } from '../../integrations/twilio/twilioClient.js'
import { config } from '../../shared/config.js'
import { logger } from '../../shared/logger.js'
import { prisma } from '../../shared/prisma.js'

type AuthResult = {
  token: string
  userId: string
}

const jwtExpiresIn = '30d'
const developmentNodeEnv = 'development'
const bypassLogMessage = 'Dev phone verification bypass applied'
const bypassSkipRequestLogMessage = 'Dev phone verification request bypassed'
const bypassPhoneLogField = 'phoneNumber'

const isDevBypassPhoneNumber = (phoneNumber: string): boolean => {
  const prefix = config.auth.devPhoneBypassPrefix

  return config.nodeEnv === developmentNodeEnv && phoneNumber.startsWith(prefix)
}

/**
 * AuthService
 * - Issues JWTs after successful Twilio Verify checks.
 * - Upserts users by phone number.
 * - Used by GraphQL auth mutations.
 */
export class AuthService {
  public async requestPhoneVerification(phoneNumber: string): Promise<void> {
    if (isDevBypassPhoneNumber(phoneNumber)) {
      logger.info({ [bypassPhoneLogField]: phoneNumber }, bypassSkipRequestLogMessage)
      return
    }

    await twilioClient.verify.v2
      .services(config.twilio.verifyServiceSid)
      .verifications.create({ to: phoneNumber, channel: 'sms' })
  }

  public async verifyPhoneCode(phoneNumber: string, code: string): Promise<AuthResult> {
    if (isDevBypassPhoneNumber(phoneNumber)) {
      logger.info({ [bypassPhoneLogField]: phoneNumber }, bypassLogMessage)
      return this.issueTokenForPhone(phoneNumber)
    }

    const verification = await twilioClient.verify.v2
      .services(config.twilio.verifyServiceSid)
      .verificationChecks.create({ to: phoneNumber, code })

    if (verification.status !== 'approved') {
      throw new Error('Invalid verification code')
    }

    return this.issueTokenForPhone(phoneNumber)
  }

  /**
   * issueTokenForPhone
   * - Upserts user by phone number.
   * - Issues a JWT for the user.
   * - Used by Twilio verification flow and dev bypass.
   */
  private async issueTokenForPhone(phoneNumber: string): Promise<AuthResult> {
    const user = await prisma.user.upsert({
      where: { phoneNumber },
      create: { phoneNumber },
      update: {}
    })

    const token = jwt.sign({ userId: user.id }, config.auth.jwtSecret, {
      expiresIn: jwtExpiresIn
    })

    return { token, userId: user.id }
  }
}
