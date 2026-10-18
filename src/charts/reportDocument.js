import { reportMetricGroup, reportMetricGroups, reportValue } from './reportAnalysis.js'

const escape = value => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const periodText = range => `${range.start.replace('T', ' ')} — ${range.end.replace('T', ' ')}`
const number = value => escape(reportValue(value))

function rowStatus(row) {
  const problems = [...row.errors]
  if (row.current?.truncated || row.baseline?.truncated) problems.push('历史达到查询上限，变化不可比')
  if (!row.current?.count) problems.push('本期无有效数据')
  else if (row.current.coverage < 0.6) problems.push('本期数据稀疏，变化不可比')
  if (row.current?.count && !row.baseline?.count) problems.push('对比期无有效数据')
  else if (row.baseline?.coverage < 0.6) problems.push('对比期数据稀疏，变化不可比')
  if (row.current?.invalid) problems.push(`${row.current.invalid} 条无效采样已剔除`)
  if (row.current?.overCount > 0) problems.push(`${row.current.overCount} 次采样越限`)
  if (row.change.percent !== null && Math.abs(row.change.percent) >= 10) problems.push('均值变化达到 10%，请复核')
  return problems.join('；') || '未发现需复核项'
}

function trendSvg(row, range) {
  const values = row.current?.minutes || []
  if (values.length < 2) return '<span class="muted">数据不足</span>'
  const low = Math.min(...values.map(item => item.value)), high = Math.max(...values.map(item => item.value))
  const duration = Date.parse(range.end) - Date.parse(range.start)
  const paths = []
  values.forEach((item, index) => {
    const x = 2 + (item.time - Date.parse(range.start)) / duration * 176
    const y = 34 - (item.value - low) / (high - low || 1) * 28
    paths.push(`${!index || item.time - values[index - 1].time > 90000 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
  })
  return `<svg viewBox="0 0 180 40" role="img" aria-label="本期滤波趋势，缺数处断开"><path d="${paths.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`
}

export function reportHtml(report, { title, scope, notes = '' }) {
  const rows = report.rows.filter(row => reportMetricGroup(row.point))
  const attention = rows.filter(row => row.attention)
  const warnings = [...(report.catalogErrors || [])]
  const eventSummary = []
  for (const kind of ['hard', 'trend']) {
    const label = kind === 'hard' ? '硬限值' : '趋势'
    const counts = ['current', 'baseline'].map(period => {
      const source = report.sources[kind][period]
      const prefix = `${period === 'current' ? '本期' : '对比期'}${label}告警`
      if (source.error) warnings.push(`${prefix}读取失败：${source.error}`)
      if (source.truncated) warnings.push(`${prefix}达到 1000 条上限，统计可能不完整`)
      if (source.unmapped) warnings.push(`${prefix}有 ${source.unmapped} 条未匹配所选测点，未计入`)
      return source.error || !source.events ? '读取失败' : `${source.truncated ? '至少 ' : ''}${source.events.length} 条（${(source.events.length / report.ranges[period].hours).toFixed(2)} 条/小时）`
    })
    eventSummary.push(`<tr><th>${label}新发告警</th><td>${escape(counts[0])}</td><td>${escape(counts[1])}</td></tr>`)
  }
  const sections = reportMetricGroups.map(group => {
    const selected = rows.filter(row => reportMetricGroup(row.point) === group.id)
    if (!selected.length) return ''
    return `<section><h2>${group.label}<span>${selected.length} 个测点</span></h2><div class="table-wrap"><table><thead><tr><th>测点</th><th>本期均值</th><th>最小 / 最大</th><th>对比均值</th><th>均值变化</th><th>本期趋势</th><th>复核提示</th></tr></thead><tbody>${selected.map(row => `<tr><td><strong>${escape(row.point.name)}</strong><small>${escape(row.point.moduleId)} · ${escape(row.point.pointCode)} · ${escape(row.point.unit || '无单位')}</small></td><td>${number(row.current?.mean)}</td><td>${number(row.current?.min)} / ${number(row.current?.max)}</td><td>${number(row.baseline?.mean)}</td><td>${row.change.percent === null ? (row.change.delta === null ? '不可比' : `差值 ${number(row.change.delta)}`) : `${row.change.percent > 0 ? '+' : ''}${number(row.change.percent)}%`}</td><td class="trend">${trendSvg(row, report.ranges.current)}</td><td class="${row.attention ? 'warning' : 'muted'}">${escape(rowStatus(row))}</td></tr>`).join('')}</tbody></table></div></section>`
  }).join('')
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title>
<style>
:root{color-scheme:light;--paper:#fff;--page:#f2f5f3;--text:#20372f;--muted:#6a7b74;--border:#dfe7e2;--accent:#287152;--soft:#f5f8f6;--warning:#a35b1c}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--paper:#17241e;--page:#111a16;--text:#e6efe9;--muted:#a0b4a8;--border:#304539;--accent:#ace385;--soft:#1c2d23;--warning:#f4bb7f}}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--text);font:14px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1440px;margin:auto;padding:32px}header{border-bottom:2px solid var(--accent);padding-bottom:20px;margin-bottom:22px}.eyebrow{font-size:12px;letter-spacing:.14em;color:var(--accent)}h1{font-size:28px;margin:8px 0 12px}p{margin:6px 0}h2{font-size:17px;margin:0 0 15px}h2 span{font-weight:400;font-size:12px;color:var(--muted);margin-left:12px}section{background:var(--paper);border:1px solid var(--border);border-radius:8px;padding:20px;margin:16px 0}.muted,small{color:var(--muted)}small{display:block;font-size:11px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.metrics div{background:var(--paper);border:1px solid var(--border);border-radius:6px;padding:16px 20px}.metrics strong{font-size:27px;display:block;color:var(--accent)}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th,td{padding:12px 10px;border-bottom:1px solid var(--border)}thead th{background:var(--soft);color:var(--muted);font-weight:500;white-space:nowrap}td{font-variant-numeric:tabular-nums}td:first-child{min-width:150px}td:last-child{max-width:260px}.trend{min-width:150px;width:180px;color:var(--accent)}svg{display:block;width:100%;height:40px}.warning{color:var(--warning)}ul{margin:0;padding-left:20px}.notes{white-space:pre-wrap}footer{font-size:11px;color:var(--muted);padding:8px 0 22px}details{font-size:12px;color:var(--muted)}summary{cursor:pointer}@media(max-width:760px){main{padding:16px}.metrics{gap:8px}.metrics div{padding:12px}h1{font-size:23px}section{padding:14px}}@media print{:root{color-scheme:light;--paper:#fff;--page:#fff;--text:#20372f;--muted:#52675a;--border:#dfe7e2;--accent:#287152;--soft:#f5f8f6;--warning:#8c4a14}main{padding:0}section{break-inside:avoid}.table-wrap{overflow:visible}table{font-size:10px}th,td{padding:7px 4px}.trend{min-width:80px}}
</style></head><body><main><header><div class="eyebrow">设备健康 · 交班报告</div><h1>${escape(title)}</h1><p>${escape(periodText(report.ranges.current))}</p><p class="muted">对比期：${escape(periodText(report.ranges.baseline))}</p><small>采集范围：${escape(scope)} · 生成于 ${escape(new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }))}（北京时间）</small></header>
<div class="metrics"><div>报告测点<strong>${rows.length}</strong><small>振动 · 温度 · 负压 / 压力</small></div><div>取得有效采样<strong>${rows.filter(row => row.current?.count > 0).length}</strong><small>缺数不作为零值</small></div><div>需要交班复核<strong>${attention.length}</strong><small>越限、变化或数据问题</small></div></div>
<section><h2>交班摘要</h2><p>${attention.length ? `${attention.length} 个测点需要复核，详见下方数值与提示。` : '本次已获取的数据中未发现需复核项。'}</p><p class="muted">重点查看振动、温度和负压 / 压力的均值、极值与周期变化；负压升降本身不代表好坏。</p>${attention.length ? `<ul>${attention.slice(0, 6).map(row => `<li>${escape(row.point.name)}：${escape(rowStatus(row))}</li>`).join('')}</ul>` : ''}</section>
${sections}<section><h2>告警概况</h2><table><thead><tr><th>事件类型</th><th>本期</th><th>对比期</th></tr></thead><tbody>${eventSummary.join('')}</tbody></table><small>仅统计区间内新发且匹配本报告测点的事件，两类事件分别统计。</small></section>
${warnings.length ? `<section class="warning"><h2>数据完整性提示</h2><ul>${warnings.map(item => `<li>${escape(item)}</li>`).join('')}</ul></section>` : ''}
${notes.trim() ? `<section><h2>交班备注</h2><p class="notes">${escape(notes)}</p></section>` : ''}
<section><details><summary>统计说明</summary><p>区间采用 [开始, 结束)，仅使用质量 Good 的有限数值；0 与负数有效。均值和极值取自原始有效采样；趋势按分钟中位值、尾随 5 分钟中值及 EMA（α=0.3）处理，缺数处断开。</p><p>两期有数分钟占比均达到 60% 且未截断时才计算均值变化；占比不是设备在线率。基数为零时仅给绝对差。均值变化达到 10% 只作为复核提示。采样越限按生成时的当前阈值重算，不代替历史正式告警。</p></details></section><footer>固定 HTML 报告快照 · 可离线打开或通过浏览器打印。历史报告保留生成时的范围与结果。</footer></main></body></html>`
}
