/** Readable text for anything that was thrown. `(e as Error).message` is `undefined` for strings, objects and null. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name || 'Error'
  if (typeof e === 'string') return e || 'empty error'
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
    try {
      return JSON.stringify(e)
    } catch {
      return Object.prototype.toString.call(e)
    }
  }
  return e === undefined || e === null ? 'unknown error (nothing was thrown with it)' : String(e)
}

/** True when a notice or log line looks built from a missing value, so it can be flagged in the console. */
export function looksBroken(text: string): boolean {
  return /\b(undefined|null|NaN)\b|\[object /.test(text)
}
