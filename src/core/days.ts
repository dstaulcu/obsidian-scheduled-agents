export const MAX_DIGEST_DAYS = 365

/** Whole number of days from 1 to MAX_DIGEST_DAYS, or null. */
export function parseDays(text: string): number | null {
  const n = Number(text.trim())
  return Number.isInteger(n) && n >= 1 && n <= MAX_DIGEST_DAYS ? n : null
}
