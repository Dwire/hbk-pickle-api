import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const productionNodeEnv = 'production'
const minimumProductionJwtSecretLength = 32
const authJwtSecretPath = ['AUTH_JWT_SECRET']
const authReviewOtpPhoneNumberPath = ['AUTH_REVIEW_OTP_PHONE_NUMBER']
const authReviewOtpCodePath = ['AUTH_REVIEW_OTP_CODE']
const e164PhoneNumberPattern = /^\+[1-9]\d{1,14}$/
const weakProductionJwtSecrets = new Set([
  'dev-secret',
  'stub',
  'secret',
  'jwt-secret',
  'default',
  'change-me',
  'changeme'
])

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value
  }

  const trimmedValue = value.trim()
  if (trimmedValue.length === 0) {
    return undefined
  }

  return trimmedValue
}, z.string().min(1).optional())

const strictBooleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value !== 'string') {
    return value
  }

  const normalizedValue = value.trim().toLowerCase()
  if (normalizedValue.length === 0) {
    return undefined
  }

  if (normalizedValue === 'true') {
    return true
  }

  if (normalizedValue === 'false') {
    return false
  }

  return value
}, z.boolean())

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().positive().default(60),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_VERIFY_SERVICE_SID: z.string().min(1),
  AUTH_REVIEW_OTP_ENABLED: strictBooleanFromEnv.default(false),
  AUTH_REVIEW_OTP_PHONE_NUMBER: optionalTrimmedString,
  AUTH_REVIEW_OTP_CODE: optionalTrimmedString,
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  AUTH_JWT_SECRET: z.string().trim().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_IMAGES_API_TOKEN: z.string().min(1),
  CLOUDFLARE_IMAGES_DELIVERY_HASH: optionalTrimmedString,
  CLOUDFLARE_IMAGES_AVATAR_VARIANT: z.string().min(1).default('avatar'),
  CLOUDFLARE_IMAGES_UPLOAD_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(86_400)
    .default(900)
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === productionNodeEnv) {
    const normalizedJwtSecret = env.AUTH_JWT_SECRET.toLowerCase()

    if (env.AUTH_JWT_SECRET.length < minimumProductionJwtSecretLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: authJwtSecretPath,
        message: `AUTH_JWT_SECRET must be at least ${minimumProductionJwtSecretLength} characters when NODE_ENV=production`
      })
    }

    if (weakProductionJwtSecrets.has(normalizedJwtSecret)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: authJwtSecretPath,
        message: 'AUTH_JWT_SECRET uses a blocked weak placeholder for production'
      })
    }
  }

  if (!env.AUTH_REVIEW_OTP_ENABLED) {
    return
  }

  if (!env.AUTH_REVIEW_OTP_PHONE_NUMBER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: authReviewOtpPhoneNumberPath,
      message: 'AUTH_REVIEW_OTP_PHONE_NUMBER is required when AUTH_REVIEW_OTP_ENABLED=true'
    })
  }

  if (!env.AUTH_REVIEW_OTP_CODE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: authReviewOtpCodePath,
      message: 'AUTH_REVIEW_OTP_CODE is required when AUTH_REVIEW_OTP_ENABLED=true'
    })
  }

  if (
    env.AUTH_REVIEW_OTP_PHONE_NUMBER &&
    !e164PhoneNumberPattern.test(env.AUTH_REVIEW_OTP_PHONE_NUMBER)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: authReviewOtpPhoneNumberPath,
      message: 'AUTH_REVIEW_OTP_PHONE_NUMBER must be E.164 formatted when review OTP is enabled'
    })
  }
})

const envResult = envSchema.safeParse(process.env)

const configErrorPrefix = 'Invalid environment configuration:'

if (!envResult.success) {
  const errorMessage = `${configErrorPrefix} ${envResult.error.message}`
  process.stderr.write(`${errorMessage}\n`)
  throw new Error(errorMessage)
}

export const config = {
  nodeEnv: envResult.data.NODE_ENV,
  port: envResult.data.PORT,
  scheduler: {
    tickSeconds: envResult.data.SCHEDULER_TICK_SECONDS
  },
  databaseUrl: envResult.data.DATABASE_URL,
  redisUrl: envResult.data.REDIS_URL,
  twilio: {
    accountSid: envResult.data.TWILIO_ACCOUNT_SID,
    authToken: envResult.data.TWILIO_AUTH_TOKEN,
    verifyServiceSid: envResult.data.TWILIO_VERIFY_SERVICE_SID
  },
  firebase: {
    projectId: envResult.data.FIREBASE_PROJECT_ID,
    clientEmail: envResult.data.FIREBASE_CLIENT_EMAIL,
    privateKey: envResult.data.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  },
  auth: {
    jwtSecret: envResult.data.AUTH_JWT_SECRET,
    reviewOtp: {
      enabled: envResult.data.AUTH_REVIEW_OTP_ENABLED,
      phoneNumber: envResult.data.AUTH_REVIEW_OTP_PHONE_NUMBER ?? null,
      code: envResult.data.AUTH_REVIEW_OTP_CODE ?? null
    }
  },
  cloudflare: {
    accountId: envResult.data.CLOUDFLARE_ACCOUNT_ID,
    imagesApiToken: envResult.data.CLOUDFLARE_IMAGES_API_TOKEN,
    imagesDeliveryHash: envResult.data.CLOUDFLARE_IMAGES_DELIVERY_HASH ?? null,
    avatarVariant: envResult.data.CLOUDFLARE_IMAGES_AVATAR_VARIANT,
    uploadExpirySeconds: envResult.data.CLOUDFLARE_IMAGES_UPLOAD_EXPIRY_SECONDS
  }
}
