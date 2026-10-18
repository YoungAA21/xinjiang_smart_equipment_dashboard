import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { pointConfiguration } from '../stores/pointConfiguration.js'
import { configuredAlarmPoints, filterAlarmPoints, alarmPointOptions, normalizeAlarmScope, selectNextAlarmScope, alarmScopeLabel } from '../charts/alarmPoints.js'
import { loadAlarmPointMetadata, queryPointAlarms } from '../services/pointAlarms.js'

export function usePointAlarmQuery(fetchEvents, initial = {}) {
  const scope = reactive({ machineId: '', modelId: '', locationId: '', targetId: '', parameterId: '' })
  const filters = reactive({ isActive: '', range: [], limit: 200 })
  const metadata = ref({}), metadataError = ref(''), metadataLoading = ref(false)
  const rows = ref(null), requested = ref(null), updatedAt = ref(null), error = ref(''), loading = ref(false)
  const points = computed(() => configuredAlarmPoints(pointConfiguration, metadata.value))
  const options = computed(() => alarmPointOptions(points.value, scope))
  const selectedPoints = computed(() => filterAlarmPoints(points.value, scope))
  const controller = new AbortController()
  let queryController, metadataController, version = 0, metadataVersion = 0, initialized = false

  function invalidate() {
    queryController?.abort()
    version++
    loading.value = false
    rows.value = null
    requested.value = null
    updatedAt.value = null
    error.value = ''
  }
  async function query() {
    if (metadataLoading.value || controller.signal.aborted) return
    queryController?.abort()
    const current = ++version
    queryController = new AbortController()
    const signal = AbortSignal.any([controller.signal, queryController.signal])
    const [start, end] = filters.range || []
    const applied = { isActive: filters.isActive, start, end, limit: filters.limit }
    const label = alarmScopeLabel(points.value, scope)
    loading.value = true
    error.value = ''
    try {
      const result = await queryPointAlarms(selectedPoints.value, applied, { fetchEvents, signal })
      if (signal.aborted || current !== version) return
      rows.value = result.events
      requested.value = { ...applied, pointCount: result.pointCount, truncated: result.truncated, label }
      updatedAt.value = new Date().toISOString()
    } catch (reason) {
      if (!signal.aborted && current === version) error.value = reason.message || '告警查询失败'
    } finally { if (current === version) loading.value = false }
  }
  async function refreshPoints() {
    invalidate()
    metadataController?.abort()
    const current = ++metadataVersion
    metadataController = new AbortController()
    const signal = AbortSignal.any([controller.signal, metadataController.signal])
    metadataLoading.value = true
    metadataError.value = ''
    try {
      const result = await loadAlarmPointMetadata(points.value.map(point => point.moduleId), { signal })
      if (signal.aborted || current !== metadataVersion) return
      metadata.value = result.metadata
      metadataError.value = result.errors.join('；')
      Object.assign(scope, normalizeAlarmScope(points.value, scope))
      return true
    } catch (reason) {
      if (!signal.aborted && current === metadataVersion) metadataError.value = reason.message || '点位加载失败'
    } finally { if (current === metadataVersion) metadataLoading.value = false }
  }
  function applyInitial() {
    const value = typeof initial === 'function' ? initial() : initial
    Object.assign(scope, normalizeAlarmScope(points.value, { machineId: value.machineId || '', modelId: value.modelId || '',
      locationId: value.locationId || '', targetId: value.targetId || '', parameterId: '' }))
    const point = points.value.find(point => value.pointId ? String(point.pointId) === String(value.pointId)
      : value.moduleId && value.pointCode && point.moduleId === value.moduleId && point.pointCode === value.pointCode)
    if (point) Object.assign(scope, { machineId: point.machineId, modelId: point.modelId, locationId: point.locationId, targetId: point.targetId, parameterId: point.key })
  }
  async function initialize() {
    if (!await refreshPoints()) return
    applyInitial()
    initialized = true
    await query()
  }
  async function changeScope(key) {
    Object.assign(scope, selectNextAlarmScope(points.value, scope, key))
    invalidate()
    await query()
  }
  async function reset() {
    Object.assign(scope, { machineId: '', modelId: '', locationId: '', targetId: '', parameterId: '' })
    Object.assign(filters, { isActive: '', range: [], limit: 200 })
    invalidate()
    await query()
  }
  watch(() => JSON.stringify([pointConfiguration.locations, pointConfiguration.targets, pointConfiguration.parameters]), async () => {
    if (!initialized) return
    if (await refreshPoints()) await query()
  })
  onBeforeUnmount(() => { controller.abort(); queryController?.abort(); metadataController?.abort(); version++; metadataVersion++ })
  return { scope, filters, points, options, selectedPoints, metadataError, metadataLoading, rows, requested, updatedAt, error, loading,
    initialize, query, reset, changeScope, refreshPoints, applyInitial }
}
