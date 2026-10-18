import { defineStore } from 'pinia'
import { AlarmClock, BarChart3, Bell, ClipboardList, DatabaseZap, Home, MonitorCog, RadioTower, Router, ShieldCheck } from 'lucide-vue-next'
import { api } from '../services/api'

const axisColor = '#C3E2D9'
const gridColor = 'rgba(195, 226, 217, .12)'
const chartTooltip = { trigger: 'axis', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } }
const metricColors = ['#A8FF7D', '#46907C', '#FF8B1F', '#C3E2D9', '#FFFFFF', '#46907C']
const previewNow = Date.now()
const previewModules = [
  { moduleId: 'EQ-001', moduleName: '一号压缩机', protocol: 'ModbusTCP', host: '10.10.20.11', port: 502, pointCount: 18, channelCount: 2, latestCount: 128, runtimeStatus: { isOnline: true } },
  { moduleId: 'EQ-002', moduleName: '循环水泵 A', protocol: 'ModbusTCP', host: '10.10.20.12', port: 502, pointCount: 16, channelCount: 2, latestCount: 116, runtimeStatus: { isOnline: true } },
  { moduleId: 'EQ-003', moduleName: '主轴电机', protocol: 'Acoustic', host: '10.10.20.21', port: 9001, pointCount: 24, channelCount: 3, latestCount: 96, runtimeStatus: { isOnline: true }, channels: [{ channelId: 'CH-01', name: '声纹通道 1' }, { channelId: 'CH-02', name: '声纹通道 2' }] },
  { moduleId: 'EQ-004', moduleName: '冷却塔风机', protocol: 'ModbusTCP', host: '10.10.20.13', port: 502, pointCount: 12, channelCount: 1, latestCount: 74, runtimeStatus: { isOnline: false } },
  { moduleId: 'EQ-005', moduleName: '液压站', protocol: 'ModbusTCP', host: '10.10.20.14', port: 502, pointCount: 14, channelCount: 1, latestCount: 82, runtimeStatus: { isOnline: true } },
]
const previewLatestValues = [
  { moduleId: 'EQ-001', channelId: 'CH-01', pointCode: 'TEMP', metricType: '温度', value: 62.8, unit: '°C', quality: 'Good', collectedAt: new Date(previewNow - 60_000).toISOString() },
  { moduleId: 'EQ-002', channelId: 'CH-01', pointCode: 'PRESSURE', metricType: '压力', value: 0.72, unit: 'MPa', quality: 'Good', collectedAt: new Date(previewNow - 90_000).toISOString() },
  { moduleId: 'EQ-003', channelId: 'CH-01', pointCode: 'ACOUSTIC_RMS', metricType: '声纹', value: 38.4, unit: 'dB', quality: 'Warn', collectedAt: new Date(previewNow - 45_000).toISOString() },
  { moduleId: 'EQ-005', channelId: 'CH-01', pointCode: 'VIBRATION', metricType: '振动', value: 4.2, unit: 'mm/s', quality: 'Good', collectedAt: new Date(previewNow - 120_000).toISOString() },
]
const previewRecentValues = Array.from({ length: 8 }, (_, index) => ({
  moduleId: 'EQ-001',
  channelId: 'CH-01',
  pointCode: 'TEMP',
  metricType: '温度',
  value: [55, 57, 58, 62, 60, 64, 63, 66][index],
  unit: '°C',
  quality: 'Good',
  collectedAt: new Date(previewNow - (7 - index) * 60 * 60 * 1000).toISOString(),
}))
const previewAlarmEvents = [
  { moduleId: 'EQ-003', channelId: 'CH-01', pointCode: 'ACOUSTIC_RMS', metricType: '声纹 RMS', status: 'Active', startedAt: new Date(previewNow - 2 * 60 * 60 * 1000).toISOString(), createdAt: new Date(previewNow - 2 * 60 * 60 * 1000).toISOString() },
  { moduleId: 'EQ-001', channelId: 'CH-01', pointCode: 'TEMP', metricType: '温度过高', status: 'Closed', startedAt: new Date(previewNow - 24 * 60 * 60 * 1000).toISOString(), createdAt: new Date(previewNow - 24 * 60 * 60 * 1000).toISOString() },
  { moduleId: 'EQ-002', channelId: 'CH-01', pointCode: 'PRESSURE', metricType: '压力波动', status: 'Active', startedAt: new Date(previewNow - 3 * 24 * 60 * 60 * 1000).toISOString(), createdAt: new Date(previewNow - 3 * 24 * 60 * 60 * 1000).toISOString() },
]
const previewAlarmSegments = [
  { eventId: 'SEG-001', moduleId: 'EQ-003', channelId: 'CH-02', channelName: '声纹通道 2', alarmPointCode: 'ACOUSTIC_PEAK', alarmMetricType: '声纹峰值', alarmValue: 82.6, alarmUnit: 'dB', alarmAt: new Date(previewNow - 40 * 60 * 1000).toISOString(), savedAt: new Date(previewNow - 35 * 60 * 1000).toISOString(), files: [] },
]

const acousticMetricNames = {
  ACOUSTIC_RMS: '声纹 RMS',
  ACOUSTIC_PEAK: '声纹峰值',
  ACOUSTIC_MAIN_FREQUENCY: '主频',
  ACOUSTIC_LOW_BAND_ENERGY: '低频能量',
  ACOUSTIC_MID_BAND_ENERGY: '中频能量',
  ACOUSTIC_HIGH_BAND_ENERGY: '高频能量',
  ACOUSTIC_KURTOSIS: '峭度',
  ACOUSTIC_ANOMALY_SCORE: '异常评分',
}

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

const shortDateTime = (value) => {
  const text = formatDateTime(value)
  return text.includes(' ') ? text.split(' ')[1] || text : text
}

const formatValue = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  if (Math.abs(number) >= 100) return number.toFixed(0)
  if (Math.abs(number) >= 10) return number.toFixed(1)
  return number.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

const proxiedApiUrl = (url) => {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

const preferredSegmentFile = (segment) => {
  const files = segment.files || []
  return files.find((file) => file.fileName?.toLowerCase().endsWith('.wav')) || files[0] || null
}

const latestKey = (sample) => `${sample.moduleId}|${sample.channelId}|${sample.pointCode}`

const sameDay = (value, date = new Date()) => {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toDateString() === date.toDateString()
}

const pointName = (pointCode, metricType) => acousticMetricNames[pointCode] || metricType || pointCode || '鎸囨爣'

const findConfiguredPoint = (sample, modulePoints) => {
  const info = modulePoints[sample.moduleId]
  return info?.points?.find((point) =>
    point.channelId === sample.channelId &&
    point.pointCode === sample.pointCode)
}

const moduleTitle = (sample, modules, modulePoints = {}) => {
  const module = modules.find((item) => item.moduleId === sample.moduleId)
  const channel = module?.channels?.find((item) => item.channelId === sample.channelId)
  const configuredPoint = findConfiguredPoint(sample, modulePoints)
  const displayPointName = configuredPoint?.name
    ? `${configuredPoint.name}（${sample.pointCode}）`
    : pointName(sample.pointCode, sample.metricType)
  return `${module?.moduleName || sample.moduleId}-${channel?.name || sample.channelId}-${displayPointName}`
}

export const useDashboardStore = defineStore('dashboard', {
  state: () => ({
    menus: [
      { label: '设备监控', icon: Home, path: '/' },
      { label: '机组概览', icon: BarChart3, path: '/machine/overview' },
      { label: '测点详情', icon: MonitorCog, path: '/device' },
      { label: '网关通讯', icon: Router, path: '/gateway/communication' },
      { label: '实时监听', icon: RadioTower, path: '/realtime-listen' },
      { label: '告警管理', icon: AlarmClock, path: '/alarm/list' },
      { label: '班报与日报', icon: ClipboardList, path: '/reports' },
      { label: '参数配置', icon: MonitorCog, path: '/settings/parameters' },
    ],
    apiStatus: 'error',
    apiError: '',
    refreshedAt: formatDateTime(new Date(previewNow)),
    healthDetail: { status: '预览数据' },
    modules: previewModules,
    latestValues: previewLatestValues,
    pipeline: null,
    alarmEvents: previewAlarmEvents,
    selectedPoint: null,
    selectedModuleId: 'EQ-003',
    selectedChannelId: 'CH-01',
    selectedPointCode: 'ACOUSTIC_RMS',
    alarmModuleId: 'EQ-003',
    alarmChannelId: 'CH-01',
    alarmIsActive: true,
    modulePoints: {},
    recentValues: previewRecentValues,
    waveform: null,
    spectrum: null,
    alarmSegments: previewAlarmSegments,
    isRefreshing: false,
    pollingTimer: null,
  }),
  getters: {
    kpis: (state) => {
      const total = state.modules.length
      const online = state.modules.filter((module) => module.runtimeStatus?.isOnline).length
      const active = state.alarmEvents.filter((event) => event.status === 'Active')
      const alarmModuleIds = new Set([
        ...active.map((event) => event.moduleId),
        ...state.alarmSegments.map((segment) => segment.moduleId),
      ].filter(Boolean))
      const todayAnalysis = state.alarmEvents.filter((event) => sameDay(event.startedAt || event.createdAt)).length
      const todaySegments = state.alarmSegments.filter((segment) => sameDay(segment.alarmAt || segment.startedAt || segment.savedAt)).length
      const today = todayAnalysis + todaySegments

      return [
        { label: '设备总数', value: String(total), unit: '台', color: 'cyan', icon: DatabaseZap },
        { label: '在线设备', value: String(online), unit: '台', color: 'green', icon: ShieldCheck },
        { label: '告警设备', value: String(alarmModuleIds.size), unit: '台', color: 'red', icon: AlarmClock },
        { label: '今日告警', value: String(today), unit: '条', color: 'orange', icon: Bell },
      ]
    },
    ranking: (state) => state.modules.slice(0, 5).map((module) => [
      module.moduleName || module.moduleId,
      module.runtimeStatus?.isOnline ? '正常' : '离线',
      module.latestCount ?? 0,
    ]),
    alarmRows: (state) => state.alarmEvents.slice(0, 4).map((event) => [
      formatDateTime(event.startedAt || event.createdAt),
      `${event.moduleId}${event.channelId ? `-${event.channelId}` : ''}`,
      pointName(event.pointCode, event.metricType),
      event.status === 'Active' ? '重要' : '一般',
      event.status === 'Active' ? '未处理' : '已处理',
    ]),
    homeAlarmRows: (state) => {
      const analysisRows = state.alarmEvents.map((event) => [
        formatDateTime(event.startedAt || event.createdAt),
        `${event.moduleId}${event.channelId ? `-${event.channelId}` : ''}`,
        pointName(event.pointCode, event.metricType),
        event.status === 'Active' ? '重要' : '一般',
        event.status === 'Active' ? '未处理' : '已处理',
      ])

      const segmentRows = state.alarmSegments.map((segment) => [
        formatDateTime(segment.alarmAt || segment.startedAt || segment.savedAt),
        `${segment.moduleId}${segment.channelName ? `-${segment.channelName}` : `-${segment.channelId || ''}`}`,
        pointName(segment.alarmPointCode, segment.alarmMetricType),
        '重要',
        '已记录',
      ])

      return [...analysisRows, ...segmentRows].slice(0, 4)
    },
    longAlarmRows: (state) => state.alarmEvents.slice(0, 50).map((event) => [
      shortDateTime(event.startedAt || event.createdAt),
      `${event.moduleId}${event.channelId ? `-${event.channelId}` : ''}`,
      pointName(event.pointCode, event.metricType),
      event.status === 'Active' ? '重要' : '一般',
      event.status === 'Active' ? '未处理' : '已处理',
    ]),
    alarmListRows: (state) => {
      const analysisRows = state.alarmEvents.map((event) => ({
        time: formatDateTime(event.startedAt || event.createdAt),
        device: `${event.moduleId}${event.channelId ? `-${event.channelId}` : ''}`,
        type: pointName(event.pointCode, event.metricType),
        level: event.status === 'Active' ? '重要' : '一般',
        status: event.status === 'Active' ? '未处理' : '已处理',
        source: '分析告警',
        audioUrl: '',
        fileName: '',
      }))

      const segmentRows = state.alarmSegments.map((segment) => {
        const file = preferredSegmentFile(segment)
        return {
          time: formatDateTime(segment.alarmAt || segment.startedAt || segment.savedAt),
          device: `${segment.moduleId}${segment.channelName ? `-${segment.channelName}` : `-${segment.channelId || ''}`}`,
          type: pointName(segment.alarmPointCode, segment.alarmMetricType),
          level: '重要',
          status: '已记录',
          source: '声纹片段',
          audioUrl: proxiedApiUrl(file?.downloadUrl),
          fileName: file?.fileName || '',
        }
      })

      return [...analysisRows, ...segmentRows].slice(0, 50)
    },
    metricCards: (state) => state.latestValues.slice(0, 6).map((sample, index) => {
      const recent = state.recentValues.filter((item) => latestKey(item) === latestKey(sample))
      const configuredPoint = findConfiguredPoint(sample, state.modulePoints)
      const thresholdText = [
        configuredPoint?.minimumValue !== null && configuredPoint?.minimumValue !== undefined
          ? `下限 ${configuredPoint.minimumValue}`
          : '',
        configuredPoint?.maximumValue !== null && configuredPoint?.maximumValue !== undefined
          ? `上限 ${configuredPoint.maximumValue}`
          : '',
      ].filter(Boolean).join(' | ')
      return {
        title: moduleTitle(sample, state.modules, state.modulePoints),
        name: acousticMetricNames[sample.pointCode] ? '' : sample.metricType || '',
        value: formatValue(sample.value),
        unit: sample.unit || configuredPoint?.unit || '',
        color: metricColors[index % metricColors.length],
        sub: `${sample.quality || '-'} | ${formatDateTime(sample.collectedAt)}${thresholdText ? ` | ${thresholdText}` : ''}`,
        data: recent.length ? recent.map((item) => Number(item.value ?? 0)) : [Number(sample.value ?? 0)],
        sample,
      }
    }),
    deviceMetricCards: (state) => {
      const selectedModuleId = state.selectedModuleId || state.modules[0]?.moduleId || ''
      return state.latestValues
        .filter((sample) => !selectedModuleId || sample.moduleId === selectedModuleId)
        .slice(0, 6)
        .map((sample, index) => {
          const recent = state.recentValues.filter((item) => latestKey(item) === latestKey(sample))
          const configuredPoint = findConfiguredPoint(sample, state.modulePoints)
          const thresholdText = [
            configuredPoint?.minimumValue !== null && configuredPoint?.minimumValue !== undefined
              ? `下限 ${configuredPoint.minimumValue}`
              : '',
            configuredPoint?.maximumValue !== null && configuredPoint?.maximumValue !== undefined
              ? `上限 ${configuredPoint.maximumValue}`
              : '',
          ].filter(Boolean).join(' | ')
          return {
            title: moduleTitle(sample, state.modules, state.modulePoints),
            name: acousticMetricNames[sample.pointCode] ? '' : sample.metricType || '',
            value: formatValue(sample.value),
            unit: sample.unit || configuredPoint?.unit || '',
            color: metricColors[index % metricColors.length],
            sub: `${sample.quality || '-'} | ${formatDateTime(sample.collectedAt)}${thresholdText ? ` | ${thresholdText}` : ''}`,
            data: recent.length ? recent.map((item) => Number(item.value ?? 0)) : [Number(sample.value ?? 0)],
            sample,
          }
        })
    },
    equipmentInfo: (state) => {
      const module = state.modules.find((item) => item.moduleId === state.selectedModuleId) || state.modules[0]
      if (!module) return []
      const modulePointInfo = state.modulePoints[module.moduleId]
      return [
        ['设备编码', module.moduleId],
        ['设备类型', module.protocol],
        ['设备名称', module.moduleName || module.moduleId],
        ['设备地址', `${module.host || '-'}:${module.port || '-'}`],
        ['点位/通道', `${module.pointCount || 0} / ${module.channelCount || 0}`],
        ['已配置测点', String(modulePointInfo?.points?.length || modulePointInfo?.channels?.length || 0)],
        ['数据表', module.tableName || '-'],
        ['设备状态', module.runtimeStatus?.isOnline ? '运行中' : '离线'],
      ]
    },
    moduleOptions: (state) => state.modules.map((module) => ({
      label: `${module.moduleName || module.moduleId} (${module.protocol})`,
      value: module.moduleId,
    })),
    pointOptions: (state) => state.latestValues.map((sample) => ({
      label: moduleTitle(sample, state.modules, state.modulePoints),
      value: latestKey(sample),
      sample,
    })),
    selectedModule: (state) => state.modules.find((module) => module.moduleId === state.selectedModuleId) || state.modules[0],
    selectedChannel: (state) => {
      const module = state.modules.find((item) => item.moduleId === state.selectedModuleId)
      return module?.channels?.find((item) => item.channelId === state.selectedChannelId) || module?.channels?.[0]
    },
    healthOption: (state) => {
      const total = state.modules.length
      const online = state.modules.filter((module) => module.runtimeStatus?.isOnline).length
      const alarmModules = new Set(state.alarmEvents.filter((event) => event.status === 'Active').map((event) => event.moduleId)).size
      const offline = Math.max(total - online, 0)
      const normal = Math.max(total - alarmModules - offline, 0)

      return {
        color: ['#A8FF7D', '#FF8B1F', '#46907C'],
        graphic: [
          {
            type: 'text',
            left: '31%',
            top: '41%',
            style: {
              text: `${total}\n设备`,
              fill: '#FFFFFF',
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 20,
              textAlign: 'center',
            },
          },
        ],
        series: [
          {
            type: 'pie',
            radius: ['60%', '80%'],
            center: ['39%', '50%'],
            silent: true,
            label: { show: false },
            labelLine: { show: false },
            itemStyle: { color: 'rgba(195, 226, 217, .08)' },
            data: [{ value: total || 1 }],
          },
          {
            type: 'pie',
            radius: ['61%', '80%'],
            center: ['39%', '50%'],
            minAngle: 8,
            padAngle: 4,
            label: { show: false },
            labelLine: { show: false },
            itemStyle: {
              borderRadius: 8,
              borderColor: '#111312',
              borderWidth: 3,
              shadowBlur: 12,
              shadowColor: 'rgba(168, 255, 125, .12)',
            },
            data: [
              { value: normal || 0, name: '正常' },
              { value: alarmModules || 0, name: '告警', itemStyle: { shadowColor: 'rgba(255, 139, 31, .18)' } },
              { value: offline || 0, name: '离线', itemStyle: { shadowColor: 'rgba(70, 144, 124, .2)' } },
            ],
          },
        ],
      }
    },
    alarmTrendOption: (state) => {
      const buckets = new Map()
      const recovered = new Map()
      state.alarmEvents.forEach((event) => {
        const date = new Date(event.startedAt || event.createdAt)
        if (Number.isNaN(date.getTime())) return
        const key = `${date.getMonth() + 1}-${date.getDate()}`
        buckets.set(key, (buckets.get(key) || 0) + 1)
        if (event.status !== 'Active') recovered.set(key, (recovered.get(key) || 0) + 1)
      })
      state.alarmSegments.forEach((segment) => {
        const date = new Date(segment.alarmAt || segment.startedAt || segment.savedAt)
        if (Number.isNaN(date.getTime())) return
        const key = `${date.getMonth() + 1}-${date.getDate()}`
        buckets.set(key, (buckets.get(key) || 0) + 1)
      })
      const labels = [...buckets.keys()]

      return {
        tooltip: chartTooltip,
        color: ['#FF8B1F', '#A8FF7D'],
        legend: { right: 12, top: 0, textStyle: { color: '#C3E2D9' }, itemWidth: 18 },
        grid: { left: 36, right: 16, top: 42, bottom: 24 },
        xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: '#C3E2D9' } },
        yAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: gridColor } } },
        series: [
          { name: '告警总数', type: 'line', smooth: true, symbolSize: 7, data: labels.map((label) => buckets.get(label) || 0), areaStyle: { color: 'rgba(255,139,31,.08)' } },
          { name: '恢复数量', type: 'line', smooth: true, symbolSize: 7, data: labels.map((label) => recovered.get(label) || 0), areaStyle: { color: 'rgba(168,255,125,.10)' } },
        ],
      }
    },
    trendOption: (state) => {
      const labels = state.recentValues.map((item) => shortDateTime(item.collectedAt))
      const data = state.recentValues.map((item) => Number(item.value ?? 0))

      return {
        tooltip: chartTooltip,
        color: ['#46907C'],
        grid: { left: 44, right: 20, top: 34, bottom: 34 },
        legend: { top: 0, right: 24, textStyle: { color: '#C3E2D9' } },
        xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: '#C3E2D9' } },
        yAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: gridColor } } },
        series: [{ name: state.selectedPointCode || '实时值', type: 'line', smooth: true, symbol: 'none', data }],
      }
    },
    waveformOption: (state) => {
      const data = state.waveform?.points?.map((item) => [Number(item.timeSeconds), Number(item.value)]) || []

      return {
        tooltip: chartTooltip,
        color: ['#A8FF7D'],
        grid: { left: 46, right: 18, top: 26, bottom: 34 },
        xAxis: { type: 'value', name: 's', axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: gridColor } } },
        yAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: gridColor } } },
        series: [{ name: '实时波形', type: 'line', symbol: 'none', data, lineStyle: { width: 1.2 }, areaStyle: { color: 'rgba(168, 255, 125, .08)' } }],
      }
    },
    spectrumOption: (state) => {
      const data = state.spectrum?.bins?.map((item) => [Number(item.frequency), Number(item.magnitude)]) || []

      return {
        tooltip: chartTooltip,
        color: ['#46907C'],
        grid: { left: 44, right: 18, top: 32, bottom: 40 },
        xAxis: { type: 'value', min: 0, max: state.spectrum?.maxFrequency || 12000, axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: gridColor } } },
        yAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: gridColor } } },
        series: [{ type: 'line', symbol: 'none', data, lineStyle: { width: 1.5 }, areaStyle: { color: 'rgba(70, 144, 124, .12)' } }],
        graphic: state.spectrum ? [{ type: 'text', left: '14%', top: '11%', style: { text: `主频\n${formatValue(state.spectrum.mainFrequency)}Hz`, fill: '#A8FF7D', fontSize: 16, fontWeight: 700, textAlign: 'center' } }] : [],
      }
    },
    acousticSegmentRows: (state) => state.alarmSegments.map((segment) => {
      const file = preferredSegmentFile(segment)
      return {
        ...segment,
        alarmValueText: `${formatValue(segment.alarmValue)}${segment.alarmUnit || ''}`,
        alarmTimeText: formatDateTime(segment.alarmAt || segment.startedAt),
        savedTimeText: formatDateTime(segment.savedAt),
        audioUrl: proxiedApiUrl(file?.downloadUrl),
        fileName: file?.fileName || '-',
      }
    }),
  },
  actions: {
    async loadDashboardData({ silent = false } = {}) {
      if (this.isRefreshing) return

      this.isRefreshing = true
      if (!silent) this.apiStatus = 'loading'
      this.apiError = ''

      try {
        const [health, modules, latest, pipeline] = await Promise.allSettled([
          api.getHealthDetail(),
          api.getModules(),
          this.refreshLatestValues(silent),
          api.getPipeline(),
        ])

        if (health.status === 'fulfilled') this.healthDetail = health.value

        if (modules.status === 'fulfilled') this.modules = modules.value.modules || []

        if (latest.status === 'fulfilled') this.latestValues = latest.value || []

        if (pipeline.status === 'fulfilled') this.pipeline = pipeline.value

        const firstError = [health, modules, latest, pipeline].find((item) => item.status === 'rejected')
        if (firstError) {
          this.apiStatus = 'error'
          this.apiError = firstError.reason?.message || '后端接口连接失败'
        } else {
          this.apiStatus = 'ready'
          this.refreshedAt = formatDateTime(new Date())
        }

        this.ensureSelection()
        this.ensureAlarmSelection()
        await this.loadAllModulePoints()
        await this.loadAlarms()
        await this.loadAlarmSegments()
        await this.loadSelectedTelemetry()
      } finally {
        this.isRefreshing = false
      }
    },
    ensureSelection() {
      if (this.selectedPointCode && this.latestValues.some((item) => latestKey(item) === `${this.selectedModuleId}|${this.selectedChannelId}|${this.selectedPointCode}`)) return
      const sample = this.latestValues[0]
      if (sample) {
        this.selectPoint(sample)
        return
      }
      const module = this.modules[0]
      this.selectedModuleId = module?.moduleId || ''
      this.selectedChannelId = module?.channels?.[0]?.channelId || ''
      this.selectedPointCode = ''
      this.selectedPoint = null
    },
    ensureAlarmSelection() {
      if (this.alarmModuleId && this.alarmChannelId) return

      const acousticModule = this.modules.find((module) => module.protocol === 'Acoustic' && module.channels?.length)
      const latestSample = this.latestValues[0]

      if (acousticModule?.channels?.[0]) {
        this.alarmModuleId = acousticModule.moduleId
        this.alarmChannelId = acousticModule.channels[0].channelId
        return
      }

      this.alarmModuleId = latestSample?.moduleId || this.selectedModuleId || ''
      this.alarmChannelId = latestSample?.channelId || this.selectedChannelId || ''
    },
    selectPoint(sampleOrKey) {
      const sample = typeof sampleOrKey === 'string'
        ? this.latestValues.find((item) => latestKey(item) === sampleOrKey)
        : sampleOrKey
      if (!sample) return
      this.selectedPoint = sample
      this.selectedModuleId = sample.moduleId
      this.selectedChannelId = sample.channelId
      this.selectedPointCode = sample.pointCode
    },
    async selectModule(moduleId) {
      const module = this.modules.find((item) => item.moduleId === moduleId)
      if (!module) return

      this.selectedModuleId = module.moduleId
      const firstSample = this.latestValues.find((item) => item.moduleId === module.moduleId)
      this.selectedChannelId = firstSample?.channelId || module.channels?.[0]?.channelId || ''
      this.selectedPointCode = firstSample?.pointCode || ''
      this.selectedPoint = firstSample || null

      await this.loadModulePoints(module.moduleId)
      await this.loadSelectedTelemetry()
    },
    async refreshLatestValues(silent = false) {
      if (!silent || !this.latestValues.length) {
        return api.getLatest()
      }

      const results = await Promise.allSettled(
        this.latestValues.map((sample) => api.getLatestPoint({
          moduleId: sample.moduleId,
          channelId: sample.channelId,
          pointCode: sample.pointCode,
        })),
      )

      const refreshed = results
        .map((result, index) => result.status === 'fulfilled' ? result.value : this.latestValues[index])
        .filter(Boolean)

      return refreshed.length ? refreshed : this.latestValues
    },
    async loadAllModulePoints() {
      const missingModuleIds = this.modules
        .map((module) => module.moduleId)
        .filter((moduleId) => moduleId && !this.modulePoints[moduleId])

      if (!missingModuleIds.length) return

      const results = await Promise.allSettled(
        missingModuleIds.map((moduleId) => api.getModulePoints(moduleId, true)),
      )

      const nextModulePoints = { ...this.modulePoints }
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          nextModulePoints[missingModuleIds[index]] = result.value
        }
      })
      this.modulePoints = nextModulePoints
    },
    async loadModulePoints(moduleId = this.selectedModuleId) {
      if (!moduleId || this.modulePoints[moduleId]) return

      const result = await api.getModulePoints(moduleId, true).catch(() => null)
      if (!result) return

      this.modulePoints = {
        ...this.modulePoints,
        [moduleId]: result,
      }
    },
    async loadSelectedTelemetry() {
      if (!this.selectedModuleId || !this.selectedChannelId || !this.selectedPointCode) {
        this.recentValues = []
        return
      }

      await this.loadModulePoints()

      const recent = await api.getRecent({
        moduleId: this.selectedModuleId,
        channelId: this.selectedChannelId,
        pointCode: this.selectedPointCode,
        count: 300,
      }).catch(() => null)
      if (recent) this.recentValues = recent
    },
    async loadSpectrum(moduleId = this.selectedModuleId, channelId = this.selectedChannelId) {
      const module = this.modules.find((item) => item.moduleId === moduleId && item.channels?.length) ||
        this.modules.find((item) => item.protocol === 'Acoustic' && item.channels?.length) ||
        this.modules.find((item) => item.channels?.length)
      const channel = module?.channels?.find((item) => item.channelId === channelId) || module?.channels?.[0]
      if (!module || !channel) {
        this.waveform = null
        this.spectrum = null
        this.alarmSegments = []
        return
      }

      this.selectedModuleId = module.moduleId
      this.selectedChannelId = channel.channelId
      this.spectrum = await api.getSpectrum({
        moduleId: module.moduleId,
        channelId: channel.channelId,
        windowMs: 1000,
        fftSize: 4096,
        maxFrequency: 12000,
      }).catch(() => null)
    },
    async loadWaveform(moduleId = this.selectedModuleId, channelId = this.selectedChannelId) {
      const module = this.modules.find((item) => item.moduleId === moduleId && item.channels?.length) ||
        this.modules.find((item) => item.protocol === 'Acoustic' && item.channels?.length) ||
        this.modules.find((item) => item.channels?.length)
      const channel = module?.channels?.find((item) => item.channelId === channelId) || module?.channels?.[0]
      if (!module || !channel) {
        this.waveform = null
        return
      }

      this.selectedModuleId = module.moduleId
      this.selectedChannelId = channel.channelId
      this.waveform = await api.getWaveform({
        moduleId: module.moduleId,
        channelId: channel.channelId,
        seconds: 5,
        maxPoints: 2000,
      }).catch(() => null)
    },
    async loadAlarmSegments(moduleId = this.alarmModuleId || this.selectedModuleId, channelId = this.alarmChannelId || this.selectedChannelId) {
      if (!moduleId || !channelId) {
        this.alarmSegments = []
        return
      }

      const result = await api.getAlarmSegments({
        moduleId,
        channelId,
        take: 50,
      }).catch(() => null)
      if (result) this.alarmSegments = result.segments || []
    },
    async loadAcousticData(moduleId = this.selectedModuleId, channelId = this.selectedChannelId) {
      const module = this.modules.find((item) => item.moduleId === moduleId && item.channels?.length) ||
        this.modules.find((item) => item.protocol === 'Acoustic' && item.channels?.length) ||
        this.modules.find((item) => item.channels?.length)
      const channel = module?.channels?.find((item) => item.channelId === channelId) || module?.channels?.[0]
      if (!module || !channel) {
        this.waveform = null
        this.spectrum = null
        this.alarmSegments = []
        return
      }

      this.selectedModuleId = module.moduleId
      this.selectedChannelId = channel.channelId
      const [waveform, spectrum, segments] = await Promise.allSettled([
        api.getWaveform({ moduleId: module.moduleId, channelId: channel.channelId, seconds: 5, maxPoints: 2000 }),
        api.getSpectrum({ moduleId: module.moduleId, channelId: channel.channelId, windowMs: 1000, fftSize: 4096, maxFrequency: 12000 }),
        api.getAlarmSegments({ moduleId: module.moduleId, channelId: channel.channelId, take: 50 }),
      ])

      if (waveform.status === 'fulfilled') this.waveform = waveform.value
      if (spectrum.status === 'fulfilled') this.spectrum = spectrum.value
      if (segments.status === 'fulfilled') this.alarmSegments = segments.value.segments || []
    },
    async loadAlarms() {
      this.ensureAlarmSelection()
      if (!this.alarmModuleId || !this.alarmChannelId) {
        this.alarmEvents = []
        return
      }

      const result = await api.getAlarms({
        moduleId: this.alarmModuleId,
        channelId: this.alarmChannelId,
        isActive: this.alarmIsActive,
        limit: 200,
      }).catch(() => null)

      if (result) this.alarmEvents = result.events || []
    },
    async setAlarmFilter({ moduleId, channelId, isActive } = {}) {
      if (moduleId !== undefined) this.alarmModuleId = moduleId
      if (channelId !== undefined) this.alarmChannelId = channelId
      if (isActive !== undefined) this.alarmIsActive = isActive
      await this.loadAlarms()
      await this.loadAlarmSegments()
    },
    async refreshForRoute(path, { silent = true } = {}) {
      await this.loadDashboardData({ silent })

      if (path === '/analysis/spectrum') {
        await this.loadAcousticData()
      }

      if (path === '/alarm/list') {
        await this.loadAlarmSegments()
      }
    },
    startRealtimePolling(getPath, intervalMs = 5000) {
      this.stopRealtimePolling()
      this.refreshForRoute(getPath(), { silent: false })
      this.pollingTimer = window.setInterval(() => {
        this.refreshForRoute(getPath(), { silent: true })
      }, intervalMs)
    },
    stopRealtimePolling() {
      if (!this.pollingTimer) return
      window.clearInterval(this.pollingTimer)
      this.pollingTimer = null
    },
    sparkOption(color, data) {
      return {
        grid: { left: 4, right: 4, top: 8, bottom: 2 },
        xAxis: { type: 'category', show: false, data: data.map((_, index) => index) },
        yAxis: { type: 'value', show: false },
        series: [{ type: 'line', smooth: true, symbol: 'none', lineStyle: { color, width: 1.8 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}55` }, { offset: 1, color: `${color}00` }] } }, data }],
      }
    },
  },
})
