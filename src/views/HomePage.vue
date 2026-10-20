<script setup>
import { computed, inject, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Pause, Play, RefreshCw, Settings2 } from 'lucide-vue-next'
import SiteProductionLinePlan from '../components/SiteProductionLinePlan.vue'
import ProductionSummary from '../components/ProductionSummary.vue'
import HomePointExplorer from '../components/HomePointExplorer.vue'
import { useAlarmColorsStore } from '../stores/alarmColors.js'
import { useProductionLine } from '../composables/useProductionLine.js'
import { alarmTime, alarmValue } from '../charts/alarms.js'
import { alarmLevelText, collectionAlarmType, alarmThresholdText } from '../charts/gradedAlarms.js'
import { alarmMachineId, isActiveAlarm, acquisitionConnectionStatus, groupedMonitoringPoints, configuredHomeReadings } from '../charts/productionLineStatus.js'
import { configuredHomeAlarms, homeAlarmTarget } from '../charts/homeAlarms.js'
import { homePointTarget, homeStatusLabel } from '../charts/homePointNavigation.js'
import { appearanceRejectionStatus } from '../charts/homeRejectionStatus.js'
import '../styles/production-line.css'

const router = useRouter()
const alarmColors = useAlarmColorsStore()
alarmColors.ensureUser()
const controls = inject('homeControlsExpanded', ref(false))
const lightTheme = inject('isLightTheme', ref(false))
const { telemetry, acoustic, selectedId, selected, machines, readings: allReadings, events, alarmError, now, live, refreshing, initialLoading, refresh } = useProductionLine()
const configuredReadings = computed(() => configuredHomeReadings(allReadings.value))
const readings = computed(() => configuredReadings.value.filter(row => row.member.source === 'legacy'))
const selectedHistoryRow = ref(null)
function openValueHistory(row) { selectedHistoryRow.value = { ...row, color: row.color || '#39a9ff' } }
const alarmScope = ref('')
const filteredEvents = computed(() => configuredHomeAlarms(events.value, alarmScope.value))
function openAlarm(event) { router.push(homeAlarmTarget(event)) }
const connectionStatus = computed(() => acquisitionConnectionStatus(telemetry.modules, acoustic.devices, { legacyError: telemetry.errors.modules, monitorError: acoustic.error }))
const systemStatus = computed(() => homeStatusLabel(connectionStatus.value.label))
const systemClass = computed(() => connectionStatus.value.state)
const dateTime = computed(() => new Date(now.value).toLocaleString('zh-CN', { hour12: false }))
const monitoringPoints = computed(() => groupedMonitoringPoints(configuredReadings.value))
const appearanceRejection = computed(() => appearanceRejectionStatus(telemetry.latest, { now: now.value, error: telemetry.errors.latest }))
const displayedMachines = computed(() => machines.value.map(machine => ({
  ...machine,
  health: machine.alarmCount > 0 ? 'alarm' : 'normal',
  healthLabel: machine.alarmCount > 0 ? '报警' : '正常',
})))
const valuesPanel = ref(null)
const valuesHeight = ref(500)
const valuesWidth = ref(400)
let valuesObserver
onMounted(() => {
  valuesObserver = new ResizeObserver(([entry]) => { valuesHeight.value = entry.contentRect.height; valuesWidth.value = entry.contentRect.width })
  if (valuesPanel.value) valuesObserver.observe(valuesPanel.value)
})
onBeforeUnmount(() => valuesObserver?.disconnect())
const rightColumns = computed(() => Math.max(1, Math.min(Math.floor(valuesWidth.value / 280), Math.ceil(readings.value.length / Math.max(1, Math.floor((valuesHeight.value - 40) / 48))))))
function gridStyle(columns) {
  return { '--columns': columns, '--rows': Math.max(1, Math.ceil(readings.value.length / columns)), '--number-size': `${Math.max(22, 30 - columns * 2)}px` }
}
function selectMachine(id) { selectedHistoryRow.value = null; selectedId.value = id; alarmScope.value = '' }
function showMachineAlarms(id) { selectedId.value = id; alarmScope.value = id }
function openMonitoringPoint(group) {
  router.push(homePointTarget(group))
}
const rowValue = row => row.value == null ? '—' : row.value.toFixed(2)
</script>

<template>
  <section :aria-busy="initialLoading" class="production-home">
    <header class="production-heading">
      <div class="system-title"><span class="system-indicator" :class="systemClass"></span><h1 :class="systemClass">{{ systemStatus }}</h1><span>各项设备均运转正常</span></div>
      <div class="production-tools"><time>{{ dateTime }}</time><button :aria-label="live ? '暂停自动刷新' : '恢复自动刷新'" @click="live = !live"><component :is="live ? Pause : Play" :size="14" />{{ live ? '实时' : '已暂停' }}</button><button aria-label="刷新数据" :disabled="refreshing" @click="refresh({ configuration: true })"><RefreshCw :size="16" :class="{ spinning: refreshing }" /></button><button aria-label="显示主题与账户设置" :aria-expanded="controls" @click="controls = !controls"><Settings2 :size="17" /></button></div>
    </header>
    <div class="line-workspace">
      <div class="line-left-column">
        <aside class="line-panel point-list-panel"><header><div><h2>{{ selected.id }} 测点列表</h2><span>{{ monitoringPoints.length }} 个</span></div></header>
          <DataLoading v-if="initialLoading" label="正在加载测点" /><div v-else-if="monitoringPoints.length" class="grouped-point-list"><DataLoading :loading="initialLoading"><button v-for="(group, index) in monitoringPoints" :key="group.key" :title="group.name" :aria-label="'查看测点详情：' + group.name" @click="openMonitoringPoint(group)"><span class="point-index">{{ String(index + 1).padStart(2, '0') }}</span><span class="group-name">{{ group.name }}</span><strong class="group-state" :class="group.state">{{ homeStatusLabel(group.label) }}</strong></button></DataLoading></div>
          <div v-else class="point-empty">{{ refreshing && selected.sourceId ? '正在加载测点' : '暂无配置测点' }}</div>
        </aside>
        <section class="line-panel rejection-status-panel" aria-label="剔除状态">
          <header><div><h2>剔除状态</h2></div></header>
          <dl><div><dt>CH双包剔除状态</dt><dd class="normal">正常</dd></div><div><dt>小包外观剔除状态</dt><dd :class="appearanceRejection.state">{{ appearanceRejection.label }}</dd></div></dl>
        </section>
      </div>
      <section class="line-panel plan-panel"><ProductionSummary /><SiteProductionLinePlan :variant="lightTheme ? 'light' : 'dark'" :navigate="false" :selected="selectedId" :machines="displayedMachines" @select="selectMachine" @alarm="showMachineAlarms" /></section>
      <aside ref="valuesPanel" class="line-panel current-values-panel"><header><div><h2>{{ selected.id }} 当前值</h2><span :class="selected.health">{{ homeStatusLabel(selected.healthLabel) }}</span></div></header>
        <DataLoading v-if="initialLoading" label="正在加载当前值" /><div v-else-if="readings.length" class="current-values-grid" :class="{ 'multiple-columns': rightColumns > 1 }" :style="gridStyle(rightColumns)"><DataLoading :loading="initialLoading"><button v-for="row in readings" :key="row.key" type="button" class="current-value" :aria-label="'查看' + row.name + '历史数据'" aria-haspopup="dialog" @click="openValueHistory(row)" :class="row.alarm ? 'alarm' : row.normal ? 'normal' : 'unknown'" :title="`${row.name} · ${live ? homeStatusLabel(row.label) : '已暂停'}${row.sample ? ' · ' + alarmTime(row.sample.collectedAt) : ''}`"><span class="value-name">{{ row.name }}</span><div class="value-reading"><strong>{{ rowValue(row) }}</strong><small>{{ row.member.source === 'legacy' ? row.point.unit : '' }}</small></div></button></DataLoading></div>
        <div v-else class="point-empty">暂无配置测点</div>
      </aside>
    </div>
    <section class="line-panel line-alarm-panel"><header><div><h2>{{ alarmScope ? alarmScope + ' 报警详情' : '告警列表' }}</h2><span v-if="alarmError">来源异常</span><span v-else>{{ filteredEvents.length }} 条</span></div><span>点击告警查看趋势与阈值设置</span></header>
      <div class="line-alarm-table"><DataLoading :loading="initialLoading"><table><thead><tr><th>级别</th><th>设备 / 测点</th><th>报警详情</th><th>报警值 / 触发阈值</th><th>发生时间</th><th>状态</th></tr></thead><tbody><tr v-for="(event, index) in filteredEvents" :key="event.alarmId ?? index" class="home-alarm-row" tabindex="0" :aria-label="'查看' + event.name + '的趋势分析与阈值设置'" @click="openAlarm(event)" @keydown.enter.prevent="openAlarm(event)" @keydown.space.prevent="openAlarm(event)" :style="{ '--row-alarm-color': alarmColors.color(event) }"><td class="alarm-level">{{ alarmLevelText(event) }}<small>{{ collectionAlarmType(event) }}</small></td><td>{{ alarmMachineId(event) || event.moduleId || '—' }}<small>{{ event.name || event.pointCode || '—' }}</small></td><td>{{ event.reason || event.name || '—' }}</td><td>{{ alarmValue(event.alarmValue, event.unit) }}<small>{{ alarmThresholdText(event) }}</small></td><td>{{ alarmTime(event.startedAt) }}</td><td>{{ isActiveAlarm(event) ? '活动告警' : event.status === 'Recovered' ? '已恢复' : '' }}</td></tr></tbody></table><div v-if="!filteredEvents.length" class="alarm-empty"><Bell :size="17" />{{ alarmError ? '告警来源暂不可用' : events === null ? '等待告警数据' : '暂无告警' }}</div></DataLoading></div>
    </section>
    <HomePointExplorer v-if="selectedHistoryRow" :key="selectedHistoryRow.key" :row="selectedHistoryRow" :buffers="telemetry.buffers" :paused="!live" @close="selectedHistoryRow = null" />
  </section>
</template>
