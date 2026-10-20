import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useTelemetryStore } from '../stores/telemetry.js'
import { useHomeDevicesStore } from '../stores/homeDevices.js'
import { telemetryApi } from '../services/telemetry.js'
import { alarmApi } from '../services/alarms.js'
import { alarmEvents } from '../stores/alarms.js'
import { buildLineMachines } from '../charts/productionLine.js'
import { presentAcousticChannels } from '../charts/machineGroups.js'
import { configuredMonitoringPoints, discoveredMonitoringModules } from '../charts/equipmentCatalog.js'
import { machineReadings, machineHealth } from '../charts/productionLineStatus.js'
import { configuredHomeAlarms } from '../charts/homeAlarms.js'

export function useProductionLine() {
  const telemetry = useTelemetryStore()
  const acoustic = useHomeDevicesStore()
  const selectedId = ref('ZJ17')
  const now = ref(Date.now())
  const live = ref(true)
  const refreshing = ref(false)
  const initialLoading = ref(true)
  const points = ref({})
  const pointErrors = ref({})
  const receivedEvents = ref(null)
  // Share configured active alarms across the list, SVG counts and machine readings.
  const events = computed(() => receivedEvents.value === null ? null : configuredHomeAlarms(receivedEvents.value))
  const alarmError = ref('')
  const controller = new AbortController()
  const options = { signal: controller.signal }
  let clockTimer, sampleTimer, metadataTimer
  let alarmRefreshing = false
  const devices = computed(() => [
    ...discoveredMonitoringModules(telemetry.modules || [], telemetry.latest || []).map(module => ({ id: module.moduleId, source: 'legacy', name: module.moduleName || module.moduleId, online: module.runtimeStatus?.isOnline, points: configuredMonitoringPoints(points.value[module.moduleId] || [], telemetry.latest, module.moduleId), raw: module })),
    ...(acoustic.devices || []).map(device => ({ id: device.deviceId, source: 'monitor', name: device.deviceName || device.deviceId, online: device.online, points: presentAcousticChannels(device), raw: device })),
  ])
  const alarmsReady = computed(() => receivedEvents.value !== null && !alarmError.value && receivedEvents.value.length < 1000)
  const machines = computed(() => buildLineMachines(devices.value, events.value || [], { legacy: Boolean(telemetry.errors.modules), monitor: Boolean(acoustic.error) }).map(machine => {
    const rows = machineReadings(machine, { latest: telemetry.latest, events: events.value || [], now: now.value,
      sourceErrors: { legacy: Boolean(telemetry.errors.latest || telemetry.errors.modules), monitor: Boolean(acoustic.error) },
      pointErrors: pointErrors.value, alarmsReady: alarmsReady.value,
    })
    const configurationReady = machine.members.every(member => member.source !== 'legacy' || (points.value[member.id] !== undefined && !pointErrors.value[member.id]))
    return { ...machine, rows, ...machineHealth({ ...machine, state: configurationReady ? machine.state : 'unknown' }, rows, alarmsReady.value) }
  }))
  const selected = computed(() => machines.value.find(machine => machine.id === selectedId.value) || machines.value[0])
  const readings = computed(() => selected.value.rows)
  async function refreshAlarms() {
    if (alarmRefreshing || controller.signal.aborted) return
    alarmRefreshing = true
    try {
      const body = await alarmApi.getAlarms({ isActive: true, limit: 1000 }, options)
      if (!controller.signal.aborted) { receivedEvents.value = alarmEvents(body); alarmError.value = '' }
    } catch (error) { if (!controller.signal.aborted) alarmError.value = error.message || '告警接口连接失败' }
    finally { alarmRefreshing = false }
  }
  async function refresh({ configuration = false } = {}) {
    if (refreshing.value || controller.signal.aborted) return
    refreshing.value = true
    try {
      await Promise.all([telemetry.refreshModules(options), telemetry.refreshLatest(options), acoustic.refresh(options), refreshAlarms()])
      const activeModules = telemetry.modules || []
      const activeIds = new Set(activeModules.map(module => module.moduleId))
      for (const id of Object.keys(points.value)) if (!activeIds.has(id)) { delete points.value[id]; delete pointErrors.value[id] }
      for (let offset = 0; offset < activeModules.length && !controller.signal.aborted; offset += 3) {
        await Promise.all(activeModules.slice(offset, offset + 3).filter(module => configuration || !points.value[module.moduleId] || pointErrors.value[module.moduleId]).map(async module => {
          try {
            const body = await telemetryApi.getModulePoints(module.moduleId, options)
            if (controller.signal.aborted) return
            if (!Array.isArray(body?.points) || body.moduleId !== module.moduleId) throw new Error('点位配置格式不正确')
            points.value[module.moduleId] = body.points.map(point => ({ ...point, moduleId: module.moduleId }))
            delete pointErrors.value[module.moduleId]
          } catch (error) { if (!controller.signal.aborted) pointErrors.value[module.moduleId] = error.message || '点位配置获取失败' }
        }))
      }
    } finally { refreshing.value = false; initialLoading.value = false }
  }
  onMounted(() => {
    refresh({ configuration: true })
    clockTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
    sampleTimer = window.setInterval(() => { if (live.value) { telemetry.refreshLatest(options); refreshAlarms() } }, 2000)
    metadataTimer = window.setInterval(() => { if (live.value) refresh({ configuration: true }) }, 30000)
  })
  onBeforeUnmount(() => {
    controller.abort()
    for (const timer of [clockTimer, sampleTimer, metadataTimer]) window.clearInterval(timer)
    telemetry.clear()
    acoustic.clear()
  })
  return { telemetry, acoustic, selectedId, selected, machines, readings, alarmsReady, events, alarmError, pointErrors, now, live, refreshing, initialLoading, refresh }
}
