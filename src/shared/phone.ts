const nonDigitRegex = /\D/g
const plusSign = '+'
const maxE164Length = 15
const minE164Length = 8
const usCountryCode = '1'
const usNationalNumberLength = 10
const usNumberWithCountryCodeLength = 11
const errorInvalidPhoneNumber = 'Invalid phone number'

/**
 * Normalize user-entered phone numbers into E.164 format.
 * - Accepts canonical numbers that already include '+'.
 * - Supports US 10-digit or 11-digit numbers when '+' is omitted.
 */
export const normalizePhoneNumber = (phoneNumber: string): string => {
  const trimmedPhoneNumber = phoneNumber.trim()

  if (trimmedPhoneNumber.length === 0) {
    throw new Error(errorInvalidPhoneNumber)
  }

  if (trimmedPhoneNumber.startsWith(plusSign)) {
    const digits = trimmedPhoneNumber.slice(1).replace(nonDigitRegex, '')

    if (digits.length < minE164Length || digits.length > maxE164Length) {
      throw new Error(errorInvalidPhoneNumber)
    }

    return `${plusSign}${digits}`
  }

  const digits = trimmedPhoneNumber.replace(nonDigitRegex, '')

  if (digits.length === usNationalNumberLength) {
    return `${plusSign}${usCountryCode}${digits}`
  }

  if (digits.length === usNumberWithCountryCodeLength && digits.startsWith(usCountryCode)) {
    return `${plusSign}${digits}`
  }

  throw new Error(errorInvalidPhoneNumber)
}
