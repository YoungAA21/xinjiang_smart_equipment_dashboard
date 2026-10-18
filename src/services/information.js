const listeners = new Set()
let messages = []
let nextId = 0

export const informationMessages = () => messages.map(item => ({ ...item }))
const notify = () => listeners.forEach(listener => listener(informationMessages()))
export function reportInformation(source, error) {
  if (error?.name === 'AbortError') return
  const message = String(error?.message || error || '').trim()
  if (!message) return
  const existing = messages.find(item => item.source === source && item.message === message)
  const item = existing
    ? { ...existing, count: existing.count + 1, time: Date.now() }
    : { id: ++nextId, source, message, count: 1, time: Date.now() }
  messages = [item, ...messages.filter(row => row.id !== item.id)].slice(0, 200)
  notify()
}
export function clearInformation() { messages = []; notify() }
export function subscribeInformation(listener) {
  listeners.add(listener)
  listener(informationMessages())
  return () => listeners.delete(listener)
}
