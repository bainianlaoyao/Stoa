export function resolvePromoDateParts(input: {
  nowIso: string
  timeZone?: string
}): {
  date: string
  timeZone: string
} {
  const timeZone = input.timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  return {
    date: formatter.format(new Date(input.nowIso)),
    timeZone
  }
}

export function addDaysToPromoDate(date: string, offsetDays: number): string {
  const [year, month, day] = date.split('-').map((value) => Number(value))
  const nextDate = new Date(Date.UTC(year, month - 1, day))
  nextDate.setUTCDate(nextDate.getUTCDate() + offsetDays)
  return nextDate.toISOString().slice(0, 10)
}
