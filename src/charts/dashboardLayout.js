export const layoutStorageKey = scope => `equipment_dashboard_layout_v1:${scope}`

export function readStoredLayout(storage, scope) {
  let text = storage.getItem(layoutStorageKey(scope))
  // Preserve browser layouts created before the machine ID correction.
  if (text === null && scope === 'machine-overview:ZJ17') text = storage.getItem(layoutStorageKey('machine-overview:ZJ117'))
  return normalizeLayout(JSON.parse(text || 'null'))
}

export function normalizeLayout(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.items)) return null
  const seen = new Set()
  return { version: 1, items: value.items.filter(item => {
    if (!item || typeof item.id !== 'string' || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }).map(item => ({
    id: item.id,
    visible: item.visible !== false,
    span: Math.max(1, Math.min(4, Math.round(Number(item.span) || 1))),
    height: Math.max(180, Math.min(900, Math.round(Number(item.height) || 260))),
  })) }
}

// Missing data must not erase saved preferences; newly discovered cards are appended.
export function reconcileLayout(items, saved, defaultSpan = 1, defaultHeight = 260) {
  const byId = new Map(items.map(item => [item.id, item]))
  const result = []
  for (const preference of saved?.items || []) {
    const item = byId.get(preference.id)
    if (item) { result.push({ ...item, ...preference }); byId.delete(preference.id) }
  }
  for (const item of byId.values()) result.push({ ...item, visible: true, span: defaultSpan, height: defaultHeight })
  return result
}

export function updateLayout(saved, current, id, patch) {
  const items = new Map((saved?.items || []).map(item => [item.id, item]))
  for (const item of current) items.set(item.id, { id: item.id, visible: item.visible, span: item.span, height: item.height })
  if (items.has(id)) items.set(id, { ...items.get(id), ...patch })
  return normalizeLayout({ version: 1, items: [...items.values()] })
}

export function moveLayout(saved, current, id, targetId) {
  const result = updateLayout(saved, current)
  const from = result.items.findIndex(item => item.id === id)
  const to = result.items.findIndex(item => item.id === targetId)
  if (from < 0 || to < 0 || from === to) return result
  const [item] = result.items.splice(from, 1)
  result.items.splice(to, 0, item)
  return result
}
