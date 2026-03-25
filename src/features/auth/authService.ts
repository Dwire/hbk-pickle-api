import jwt from 'jsonwebtoken'

import { twilioClient } from '../../integrations/twilio/twilioClient.js'
import { config } from '../../shared/config.js'
import { normalizePhoneNumber } from '../../shared/phone.js'
import { prisma } from '../../shared/prisma.js'

type AuthResult = {
  token: string
  userId: string
}

const jwtExpiresIn = '30d'
const smsChannel = 'sms'
const approvedVerificationStatus = 'approved'
const invalidVerificationCodeMessage = 'Invalid verification code'
const missingReviewAccountMessage = 'Review account is not provisioned'

/**
 * AuthService
 * - Issues JWTs after successful Twilio Verify checks.
 * - Supports optional single-account review OTP bypass via env-configured whitelist.
 * - Upserts users by phone number.
 * - Used by GraphQL auth mutations.
 */
export class AuthService {
  public async requestPhoneVerification(phoneNumber: string): Promise<void> {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber)
    const reviewOtpCode = this.getReviewOtpCodeForPhone(normalizedPhoneNumber)

    if (reviewOtpCode) {
      return
    }

    await twilioClient.verify.v2
      .services(config.twilio.verifyServiceSid)
      .verifications.create({ to: normalizedPhoneNumber, channel: smsChannel })
  }

  public async verifyPhoneCode(phoneNumber: string, code: string): Promise<AuthResult> {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber)
    const reviewOtpCode = this.getReviewOtpCodeForPhone(normalizedPhoneNumber)

    if (reviewOtpCode) {
      if (code !== reviewOtpCode) {
        throw new Error(invalidVerificationCodeMessage)
      }

      const existingUser = await prisma.user.findUnique({
        where: { phoneNumber: normalizedPhoneNumber },
        select: { id: true }
      })

      if (!existingUser) {
        throw new Error(missingReviewAccountMessage)
      }

      const user = await prisma.user.update({
        where: { id: existingUser.id },
        data: { isOnApp: true },
        select: { id: true }
      })

      const token = jwt.sign({ userId: user.id }, config.auth.jwtSecret, {
        expiresIn: jwtExpiresIn
      })

      return { token, userId: user.id }
    }

    const verification = await twilioClient.verify.v2
      .services(config.twilio.verifyServiceSid)
      .verificationChecks.create({ to: normalizedPhoneNumber, code })

    if (verification.status !== approvedVerificationStatus) {
      throw new Error(invalidVerificationCodeMessage)
    }

    const user = await prisma.user.upsert({
      where: { phoneNumber: normalizedPhoneNumber },
      create: {
        phoneNumber: normalizedPhoneNumber,
        isOnApp: true
      },
      update: { isOnApp: true }
    })

    const token = jwt.sign({ userId: user.id }, config.auth.jwtSecret, {
      expiresIn: jwtExpiresIn
    })

    return { token, userId: user.id }
  }

  private getReviewOtpCodeForPhone(normalizedPhoneNumber: string): string | null {
    const { reviewOtp } = config.auth

    if (!reviewOtp.enabled || !reviewOtp.phoneNumber || !reviewOtp.code) {
      return null
    }

    if (normalizedPhoneNumber !== reviewOtp.phoneNumber) {
      return null
    }

    return reviewOtp.code
  }
}
