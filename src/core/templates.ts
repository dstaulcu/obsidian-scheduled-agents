function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum) // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { year: t.getUTCFullYear(), week }
}

export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
/** Local ISO-ish stamp without zone, like .NET's "s" format. */
export const fmtStamp = (d: Date) => `${fmtDate(d)}T${fmtTime(d)}:${pad(d.getSeconds())}`

export function expandTemplate(text: string, now: Date, vault: string): string {
  const { year, week } = isoWeek(now)
  const map: Record<string, string> = {
    date: fmtDate(now),
    week: `${year}-W${pad(week)}`,
    month: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
    vault,
  }
  let out = text
  for (const [k, v] of Object.entries(map)) out = out.split(`{{${k}}}`).join(v)
  return out
}
