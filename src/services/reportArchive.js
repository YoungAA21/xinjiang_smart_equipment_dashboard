import { defaultReportSelection, eligibleReportPoint, reportMetricGroup, reportMetricGroups, reportRanges } from '../charts/reportAnalysis.js'
import { reportHtml } from '../charts/reportDocument.js'
import { generateEquipmentReport, loadReportCatalog } from './reports.js'

const key = (owner, kind) => `equipment_dashboard_reports_v2:${encodeURIComponent(owner)}:${kind}`
const defaults = () => ({ moduleId: '', metrics: reportMetricGroups.map(group => group.id), comparison: 'adjacent' })

export function normalizeReportConfiguration(value = {}) {
  const metrics = reportMetricGroups.map(group => group.id).filter(id => value.metrics?.includes(id))
  return { moduleId: String(value.moduleId || ''), metrics: metrics.length ? metrics : defaults().metrics, comparison: value.comparison === 'same' ? 'same' : 'adjacent' }
}

function read(owner, kind, fallback, storage) {
  const value = storage.getItem(key(owner, kind))
  return value ? JSON.parse(value) : fallback
}

export function loadReportConfiguration(owner, storage = globalThis.localStorage) {
  return normalizeReportConfiguration(read(owner, 'configuration', defaults(), storage))
}

export function saveReportConfiguration(owner, value, storage = globalThis.localStorage) {
  if (!value.metrics?.some(id => reportMetricGroups.some(group => group.id === id))) throw new Error('请至少选择一类重点指标')
  try { storage.setItem(key(owner, 'configuration'), JSON.stringify(normalizeReportConfiguration(value))) }
  catch { throw new Error('报告配置保存失败，请检查浏览器存储空间或权限') }
}

export const reportSelectionId = selection => `${selection.mode}:${selection.date}:${selection.mode === 'daily' ? 'daily' : selection.shift}`
export const reportTitle = selection => `${selection.date} ${selection.mode === 'daily' ? '日报' : selection.shift === 'day' ? '早班班报' : '晚班班报'}`

export function listReportSnapshots(owner, storage = globalThis.localStorage) {
  const values = read(owner, 'snapshots', [], storage)
  if (!Array.isArray(values)) throw new Error('本机报告存档格式不正确')
  return values
}

export function saveReportSnapshot(owner, snapshot, { storage = globalThis.localStorage, replace = false } = {}) {
  const snapshots = listReportSnapshots(owner, storage)
  const existing = snapshots.find(item => item.id === snapshot.id)
  if (existing && !replace) return existing
  const next = [snapshot, ...snapshots.filter(item => item.id !== snapshot.id)].slice(0, 60)
  try { storage.setItem(key(owner, 'snapshots'), JSON.stringify(next)) }
  catch { throw new Error('HTML 报告保存失败，请检查浏览器存储空间或权限后重试') }
  return snapshot
}

// Querying builds an in-memory result. Persistence is an explicit, separate action.
export async function queryReport({ owner, selection, configuration, signal, onProgress, presentPoint = point => point, storage = globalThis.localStorage, loadCatalog = loadReportCatalog, generate = generateEquipmentReport }) {
  signal?.throwIfAborted()
  const config = normalizeReportConfiguration(configuration || loadReportConfiguration(owner, storage))
  const appliedSelection = { ...selection, comparison: selection.comparison || config.comparison }
  const ranges = reportRanges(appliedSelection)
  const id = reportSelectionId(appliedSelection)
  const catalog = await loadCatalog({ signal })
  signal?.throwIfAborted()
  const points = catalog.points.map(presentPoint).filter(point => eligibleReportPoint(point)
    && (!config.moduleId || String(point.moduleId) === config.moduleId) && config.metrics.includes(reportMetricGroup(point)))
  if (!points.length) throw new Error('当前报告范围没有振动、温度或负压 / 压力测点，请调整报告配置')
  const report = await generate({ points, ranges, signal, onProgress })
  signal?.throwIfAborted()
  if (!report.rows.some(row => row.current)) throw new Error(`本期所有测点查询均失败：${report.rows[0]?.errors?.join('；') || '请稍后重试'}`)
  const module = catalog.modules.find(item => String(item.moduleId) === config.moduleId)
  const scope = `${config.moduleId ? module?.moduleName || config.moduleId : '全部采集模块'} · ${config.metrics.map(id => reportMetricGroups.find(group => group.id === id).label).join(' / ')}`
  const title = reportTitle(appliedSelection)
  const snapshot = { id, title, selection: appliedSelection, configuration: config, scope, ranges, generatedAt: report.generatedAt,
    html: reportHtml({ ...report, catalogErrors: catalog.errors }, { title, scope }) }
  signal?.throwIfAborted()
  return { snapshot, report: { ...report, catalogErrors: catalog.errors } }
}

// Compatibility for callers explicitly requesting a persisted snapshot.
export async function resolveReportSnapshot(options) {
  const { owner, selection, signal, replace = false, storage = globalThis.localStorage, onReport } = options
  signal?.throwIfAborted()
  reportRanges(selection)
  if (!replace) {
    const existing = listReportSnapshots(owner, storage).find(item => item.id === reportSelectionId(selection))
    if (existing) return existing
  }
  const { snapshot, report } = await queryReport(options)
  signal?.throwIfAborted()
  const saved = saveReportSnapshot(owner, snapshot, { replace, storage })
  onReport?.(report)
  return saved
}

export function previousReportSelection(selection) {
  const { baseline } = reportRanges({ ...selection, comparison: 'adjacent' })
  return { mode: selection.mode, date: baseline.start.slice(0, 10), shift: baseline.start.slice(11, 13) === '09' ? 'day' : 'night' }
}

export function latestReportSelection(mode = 'shift') {
  const initial = defaultReportSelection()
  return { mode, date: mode === 'daily' ? initial.yesterday : initial.date, shift: initial.shift }
}

export function downloadReport(snapshot) {
  const url = URL.createObjectURL(new Blob([snapshot.html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${snapshot.title}.html`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
