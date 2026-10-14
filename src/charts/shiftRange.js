import { localInputTime } from './telemetry.js'

// Preserve the existing production schedule: day 09:30–18:00, night 18:00–02:00.
// Before the next day shift starts, the most recently started night shift applies.
export function shiftRange(mode = 'current', now = new Date()) {
  const clock = new Date(now)
  const start = new Date(clock)
  const minutes = clock.getHours() * 60 + clock.getMinutes()
  let day = minutes >= 570 && minutes < 1080
  if (minutes < 570) start.setDate(start.getDate() - 1)
  if (mode === 'previous') {
    if (day) start.setDate(start.getDate() - 1)
    day = !day
  }
  start.setHours(day ? 9 : 18, day ? 30 : 0, 0, 0)
  const end = new Date(start)
  if (!day) end.setDate(end.getDate() + 1)
  end.setHours(day ? 18 : 2, 0, 0, 0)
  return { start: localInputTime(start), end: localInputTime(end) }
}
