<script setup>
import { computed, inject, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, ChevronLeft, ChevronRight, Pause, Play, RefreshCw, Settings2 } from 'lucide-vue-next'
import SiteProductionLinePlan from '../components/SiteProductionLinePlan.vue'
import ProductionSummary from '../components/ProductionSummary.vue'
import AlarmColorSettings from '../components/AlarmColorSettings.vue'
import { useAlarmColorsStore } from '../stores/alarmColors.js'
import { readingState } from '../charts/productionLine.js'
import { useProductionLine } from '../composables/useProductionLine.js'
import { alarmTime } from '../charts/alarms.js'
import { alarmMachineId, isActiveAlarm, acquisitionConnectionStatus, groupedMonitoringPoints } from '../charts/productionLineStatus.js'
import { monitoringLocationOf } from '../charts/monitoringLocations.js'
import '../styles/production-line.css'

const router = useRouter()
const alarmColors = useAlarmColorsStore()
alarmColors.ensureUser()
const controls = inject('homeControlsExpanded', ref(false))
const lightTheme = inject('isLightTheme', ref(false))
const { telemetry, acoustic, selectedId, selected, machines, readings, events, alarmError, now, live, refreshing, refresh } = useProductionLine()
const alarmScope = ref('')
const alarmFilter = ref('active')
const alarmPage = ref(1)
const pageSize = 2
const filteredEvents = computed(() => (events.value || []).filter(event => (!alarmScope.value || alarmMachineId(event) === alarmScope.value) && (alarmFilter.value === 'all' || isActiveAlarm(event))).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredEvents.value.length / pageSize)))
const visibleEvents = computed(() => filteredEvents.value.slice((alarmPage.value - 1) * pageSize, alarmPage.value * pageSize))
watch([alarmScope, alarmFilter], () => { alarmPage.value = 1 })
watch(pageCount, count => { alarmPage.value = Math.min(alarmPage.value, count) })
const connectionStatus = computed(() => acquisitionConnectionStatus(telemetry.modules, acoustic.devices, { legacyError: telemetry.errors.modules, monitorError: acoustic.error }))
const systemStatus = computed(() => connectionStatus.value.label)
const systemClass = computed(() => connectionStatus.value.state)
const dateTime = computed(() => new Date(now.value).toLocaleString('zh-CN', { hour12: false }))
const monitoringPoints = computed(() => groupedMonitoringPoints(readings.value))
const valuesPanel = ref(null)
const valuesHeight = ref(500)
let valuesObserver
onMounted(() => {
  valuesObserver = new ResizeObserver(([entry]) => { valuesHeight.value = entry.contentRect.height })
  if (valuesPanel.value) valuesObserver.observe(valuesPanel.value)
})
onBeforeUnmount(() => valuesObserver?.disconnect())
const rightColumns = computed(() => Math.max(1, Math.ceil(readings.value.length / Math.max(1, Math.floor((valuesHeight.value - 40) / 43)))))
function gridStyle(columns) {
  return { '--columns': columns, '--rows': Math.max(1, Math.ceil(readings.value.length / columns)), '--number-size': `${Math.max(12, 22 - columns * 2)}px` }
}
function selectMachine(id) { selectedId.value = id; alarmScope.value = '' }
function showMachineAlarms(id) { selectedId.value = id; alarmScope.value = id; alarmFilter.value = 'active'; alarmPage.value = 1 }
function openPoint(row) {
  router.push({ path: '/device/detail', query: {
    source: row.member.source, device: String(row.member.id), pointId: row.point.pointId,
    channelId: row.point.channelId, pointCode: row.point.pointCode,
    location: monitoringLocationOf(row.member, row.point) || undefined, tab: 'live',
  } })
}
function openMonitoringPoint(group) {
  if (group.location) router.push({ path: '/device', query: { location: group.location } })
  else openPoint(group.rows[0])
}
const rowValue = row => !row.usable ? '—' : row.member.source === 'monitor' ? '在线' : row.value.toFixed(2)
const rejectionState = computed(() => {
  const point = { moduleId:'PRESS01', channelId:'PRESS01-DI02', pointCode:'PRESS01_DI02' }
  const module = telemetry.modules?.find(module => module.moduleId === point.moduleId)
  const reading = readingState(point, telemetry.latest, now.value, Boolean(telemetry.errors.latest), module?.runtimeStatus?.isOnline)
  return !reading.usable || ![0, 1].includes(reading.value) ? '—' : reading.value === 1 ? '按钮已触发' : '按钮未触发'
})
</script>

<template>
  <section class="production-home">
    <header class="production-heading">
      <div class="system-title"><span class="system-indicator" :class="systemClass"></span><h1 :class="systemClass">{{ systemStatus }}</h1><span>采集设备连接状态</span></div>
      <div class="production-tools"><time>{{ dateTime }}</time><button :aria-label="live ? '暂停自动刷新' : '恢复自动刷新'" @click="live = !live"><component :is="live ? Pause : Play" :size="14" />{{ live ? '实时' : '已暂停' }}</button><button aria-label="刷新数据" :disabled="refreshing" @click="refresh({ configuration: true })"><RefreshCw :size="16" :class="{ spinning: refreshing }" /></button><button aria-label="显示主题与账户设置" :aria-expanded="controls" @click="controls = !controls"><Settings2 :size="17" /></button></div>
    </header>
    <div class="line-workspace">
      <aside class="line-panel point-list-panel"><header><div><h2>{{ selected.id }} 测点列表</h2><span>{{ monitoringPoints.length }} 个</span></div></header>
        <div v-if="monitoringPoints.length" class="grouped-point-list"><button v-for="(group, index) in monitoringPoints" :key="group.key" :title="group.name" :aria-label="'查看测点详情：' + group.name" @click="openMonitoringPoint(group)"><span class="point-index">{{ String(index + 1).padStart(2, '0') }}</span><span class="group-name">{{ group.name }}</span><strong class="group-state" :class="group.state">{{ group.label }}</strong></button></div>
        <div v-else class="point-empty">{{ refreshing && selected.sourceId ? '正在加载测点' : '暂无配置测点' }}</div>
      </aside>
      <section class="line-panel plan-panel"><ProductionSummary :rejection-state="rejectionState" /><SiteProductionLinePlan :variant="lightTheme ? 'light' : 'dark'" :navigate="false" :selected="selectedId" :machines="machines" @select="selectMachine" @alarm="showMachineAlarms" /></section>
      <aside ref="valuesPanel" class="line-panel current-values-panel"><header><div><h2>{{ selected.id }} 当前值</h2><span :class="selected.health">{{ selected.healthLabel }}</span></div></header>
        <div v-if="readings.length" class="current-values-grid" :class="{ 'multiple-columns': rightColumns > 1 }" :style="gridStyle(rightColumns)"><div v-for="row in readings" :key="row.key" class="current-value" :class="row.alarm ? 'alarm' : row.normal ? 'normal' : 'unknown'" :title="`${row.name} · ${row.label}${row.sample ? ' · ' + alarmTime(row.sample.collectedAt) : ''}`"><span class="value-name">{{ row.name }}</span><div><strong>{{ rowValue(row) }}</strong><small>{{ row.member.source === 'legacy' ? row.point.unit : '' }}</small><span class="value-state">{{ live ? row.label : '已暂停' }}</span></div></div></div>
        <div v-else class="point-empty">暂无配置测点</div>
      </aside>
    </div>
    <section class="line-panel line-alarm-panel"><header><div><h2>{{ alarmScope ? alarmScope + ' 报警详情' : '告警列表' }}</h2><span v-if="alarmError">来源异常</span><span v-else>{{ filteredEvents.length }} 条</span></div><div class="alarm-actions"><AlarmColorSettings :events="events || []" /><button v-if="alarmScope" @click="alarmScope = ''">全部机组</button><button :class="{ active: alarmFilter === 'active' }" @click="alarmFilter = 'active'">活动告警</button><button :class="{ active: alarmFilter === 'all' }" @click="alarmFilter = 'all'">全部记录</button><button aria-label="上一页告警" :disabled="alarmPage === 1" @click="alarmPage--"><ChevronLeft :size="13" /></button><span>{{ alarmPage }} / {{ pageCount }}</span><button aria-label="下一页告警" :disabled="alarmPage === pageCount" @click="alarmPage++"><ChevronRight :size="13" /></button></div></header>
      <div class="line-alarm-table"><table><thead><tr><th>级别</th><th>设备 / 测点</th><th>报警详情</th><th>当前 / 阈值</th><th>发生时间</th><th>状态</th></tr></thead><tbody><tr v-for="(event, index) in visibleEvents" :key="event.alarmId || index" :style="{ '--row-alarm-color': alarmColors.color(event) }"><td class="alarm-level">{{ event.severity || event.level || '告警' }}</td><td>{{ alarmMachineId(event) || event.moduleId || '—' }}<small>{{ event.name || event.pointCode || '—' }}</small></td><td>{{ event.reason || event.name || '—' }}</td><td>{{ event.alarmValue ?? '—' }} {{ event.unit }} / {{ event.threshold ?? event.thresholdValue ?? '—' }}</td><td>{{ alarmTime(event.startedAt) }}</td><td>{{ isActiveAlarm(event) ? '活动告警' : event.status === 'Recovered' ? '已恢复' : '待确认' }}</td></tr></tbody></table><div v-if="!visibleEvents.length" class="alarm-empty"><Bell :size="17" />{{ alarmError ? '告警来源暂不可用' : events === null ? '等待告警数据' : '暂无告警' }}</div></div>
    </section>
  </section>
</template>

