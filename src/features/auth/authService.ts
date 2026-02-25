import jwt from 'jsonwebtoken'

import { twilioClient } from '../../integrations/twilio/twilioClient.js'
import { config } from '../../shared/config.js'
import { prisma } from '../../shared/prisma.js'

type AuthResult = {
  token: string
  userId: string
}

const jwtExpiresIn = '30d'

/**
 * AuthService
 * - Issues JWTs after successful Twilio Verify checks.
 * - Upserts users by phone number.
 * - Used by GraphQL auth mutations.
 */
export class AuthService {
  public async requestPhoneVerification(phoneNumber: string): Promise<void> {
    await twilioClient.verify.v2
      .services(config.twilio.verifyServiceSid)
      .verifications.create({ to: phoneNumber, channel: 'sms' })
  }

  public async verifyPhoneCode(phoneNumber: string, code: string): Promise<AuthResult> {
    const verification = await twilioClient.verify.v2
      .services(config.twilio.verifyServiceSid)
      .verificationChecks.create({ to: phoneNumber, code })

    if (verification.status !== 'approved') {
      throw new Error('Invalid verification code')
    }

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
