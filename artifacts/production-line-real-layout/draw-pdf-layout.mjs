import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { productionLineLayout, productionLineViewBox } from '../../src/charts/productionLineLayout.js'
import { productionLineTarget } from '../../src/charts/productionLineTargets.js'

const output = new URL('./', import.meta.url)
const publicOutput = new URL('../../public/production-line/', import.meta.url)
const { paths } = JSON.parse(await fs.readFile(new URL('./pdf-layout-paths.json', import.meta.url), 'utf8'))
const variants = [
  { file: '01-real-dark', title: '实际产线布局 · 深色机械线稿', bg: '#101c18', grid: '#20382e', stroke: '#9bb9a9', accent: '#78d4ad', text: '#edf6f0', muted: '#91ab9e' },
  { file: '02-real-light', title: '实际产线布局 · 浅色工程图', bg: '#f7fafc', grid: '#e1e9ef', stroke: '#42627b', accent: '#287f99', text: '#19384d', muted: '#638194' },
  { file: '03-real-flat', title: '实际产线布局 · 扁平设备轮廓', bg: '#f5f8f5', grid: '#e9efea', stroke: '#507767', accent: '#278e65', text: '#213d30', muted: '#6f8779' },
]
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
const label = (x, y, value, cls = 'label') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="middle">${escape(value)}</text>`
const inside = ([x0, y0, x1, y1], m) => x0 >= m.x - 4 && y0 >= m.y - 4 && x1 <= m.x + m.w + 4 && y1 <= m.y + m.h + 4
const pathMarkup = item => `<path d="${item.d}"${item.fill ? ' class="solid"' : ''}/>`
// Arrows follow existing PDF conveyors, without adding conveyor geometry.
const flows = ['M 1270 391 H 1210', 'M 1025 390 H 960', 'M 825 390 H 755', 'M 80 310 V 375', 'M 80 565 V 630', 'M 80 755 V 810', 'M 140 837 H 205', 'M 283 805 V 745', 'M 81 244 H 145', 'M 295 310 V 355', 'M 413 390 H 350', 'M 260 390 H 225']

await fs.mkdir(publicOutput, { recursive: true })
for (const variant of variants) {
  const assigned = new Set()
  const machines = productionLineLayout.map(machine => {
    const target = productionLineTarget(machine.id)
    const tag = target ? 'a' : 'g'
    const attributes = target ? ` class="machine-link" data-machine="${machine.id}" href="/#/monitor?machine=${encodeURIComponent(target.query.machine)}" target="_top" tabindex="0" aria-label="${machine.id} ${machine.name}"` : ''
    const geometry = paths.filter((item, index) => {
      if (assigned.has(index) || !inside(item.bounds, machine)) return false
      assigned.add(index)
      return true
    }).map(pathMarkup).join('')
    return `<${tag} id="machine-${machine.id}" data-device="${machine.id}"${attributes}><title>${machine.name}</title>${target ? `<rect class="hit-area" x="${machine.x}" y="${machine.y}" width="${machine.w}" height="${machine.h}"/>` : ''}<g class="machine-geometry">${geometry}</g>${label(machine.lx, machine.ly, machine.id === 'MAIN-CABINET' ? machine.name : machine.id)}${machine.id === 'MAIN-CABINET' ? '' : label(machine.lx, machine.ly + 26, machine.name, 'name')}</${tag}>`
  }).join('')
  const css = `text{font-family:'Microsoft YaHei','PingFang SC',Arial,sans-serif}.drawing{fill:none;stroke:${variant.stroke};stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}.solid{fill:${variant.stroke};stroke:none}.label{fill:${variant.text};stroke:none;font-size:24px;font-weight:650;letter-spacing:.6px}.name{fill:${variant.muted};stroke:none;font-size:17px}.hit-area{fill:transparent;stroke:none;pointer-events:all}.machine-link{cursor:pointer;outline:none;text-decoration:none}.machine-link:hover .machine-geometry,.machine-link:focus-visible .machine-geometry{stroke:${variant.accent};stroke-width:2.6}.machine-link:hover text,.machine-link:focus-visible text{fill:${variant.accent}}.flow{fill:none;stroke:${variant.accent};stroke-width:2.5;marker-end:url(#arrow)}`
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1030" viewBox="${productionLineViewBox}" role="img" aria-labelledby="drawing-title drawing-desc"><title id="drawing-title">${variant.title}</title><desc id="drawing-desc">按现场 PDF 第一页矢量路径重绘，顺时针旋转为横向。右端为 ZJ117，偏置储烟滚筒位于主输送线上侧，主电柜右侧整段为 YB25；左下横向设备左部为 YB95、右端双辊区域为 YB65，其下方竖向设备为 YB55。设备身份沿用既有监测映射。</desc><style>${css}</style><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 H 0 V 24" fill="none" stroke="${variant.grid}" stroke-width=".6"/></pattern><marker id="arrow" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 1 L 11 6 L 0 11 Z" fill="${variant.accent}"/></marker></defs><rect width="1800" height="1030" fill="${variant.bg}"/><rect x="35" y="40" width="1730" height="950" rx="8" fill="url(#grid)" stroke="${variant.grid}"/><g class="drawing"><g id="conveyors">${paths.filter((_, index) => !assigned.has(index)).map(pathMarkup).join('')}</g>${machines}</g><g id="storage-drum" data-device="STORAGE-DRUM"><title>储烟滚筒</title>${label(905, 305, '储烟滚筒', 'name')}</g><g id="material-flow">${flows.map(d => `<path class="flow" d="${d}"/>`).join('')}</g></svg>
`
  await fs.writeFile(new URL(`${variant.file}.svg`, output), svg)
  await fs.writeFile(new URL(`${variant.file}.svg`, publicOutput), svg)
  console.log(fileURLToPath(new URL(`${variant.file}.svg`, publicOutput)))
}

// SVG generation needs only Node. PNG previews optionally use a local sharp installation.
if (process.argv.includes('--png')) {
  const { default: sharp } = await import(process.env.PRODUCTION_LINE_SHARP || 'sharp')
  for (const variant of variants) {
    await sharp(await fs.readFile(new URL(`${variant.file}.svg`, output))).png().toFile(fileURLToPath(new URL(`${variant.file}.png`, output)))
  }
}
