type TimeKey =
  | "common.time.justNow"
  | "common.time.minutesAgo.short"
  | "common.time.hoursAgo.short"
  | "common.time.daysAgo.short"

type Translate = (key: TimeKey, params?: Record<string, string | number>) => string

export function getRelativeTime(dateString: string, t: Translate): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return t("common.time.justNow")
  if (diffMinutes < 60) return t("common.time.minutesAgo.short", { count: diffMinutes })
  if (diffHours < 24) return t("common.time.hoursAgo.short", { count: diffHours })
  return t("common.time.daysAgo.short", { count: diffDays })
}

export function formatCompactDuration(ms: number): string {
  if (ms <= 0) return "0s"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) {
    const seconds = totalSeconds % 60
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
}
