import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { productionLineTarget } from '../../src/charts/productionLineTargets.js'
const require = createRequire(import.meta.url)
const sharp = require('C:/Users/14116/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')
const output = 'C:/Users/14116/WebstormProjects/xinjiang_smart_equipment_dashboard/artifacts/production-line-real-layout'
const rect = (x,y,w,h,cls='part',r=2) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`
const circle = (x,y,r,cls='part') => `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`
const line = (d,cls='detail') => `<path class="${cls}" d="${d}"/>`
const text = (x,y,value,cls='label',anchor='middle') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${value}</text>`
const roller = (x,y,r) => `<g class="detail">${circle(x,y,r)}${circle(x,y,6)}${line(`M ${x-r} ${y} H ${x+r} M ${x} ${y-r} V ${y+r}`)}</g>`
const vents = (x,y,count=7) => Array.from({length:count},(_,i)=>line(`M ${x} ${y+i*8} h 26`)).join('')
const bolts = (w,h) => `<g class="detail">${[10,w-10].flatMap(x=>[10,h-10].map(y=>circle(x,y,2))).join('')}</g>`
const symbols = {
 maker: `${line('M 0 90 H 196 V 0 H 286 V 218 H 0 Z','body')}${rect(7,98,183,110)}${rect(204,8,74,200)}<g class="detail">${rect(16,105,81,93)}${roller(56,151,32)}${rect(106,107,74,92)}${rect(117,120,21,63)}${rect(149,120,21,63)}${rect(215,20,51,72)}${roller(240,56,23)}${rect(214,107,53,88)}${rect(222,118,36,65)}${line('M 6 216 H 186 M 188 99 H 204 M 180 128 H 204 M 180 178 H 204 M 214 98 H 268')}${rect(80,218,40,15)}${rect(286,102,16,58)}</g>`,
 packer: `${rect(0,28,215,111,'body',4)}${rect(27,0,146,166)}<g class="detail">${rect(34,8,132,150)}${rect(44,17,54,48)}${rect(52,25,38,32)}${roller(105,111,31)}${rect(180,12,20,139)}${vents(7,47,8)}${line('M 140 18 V 74 M 154 18 V 74 M 38 77 H 162 M 34 153 H 166 M 52 168 V 179 H 67 V 166')}${rect(0,71,19,36)}${rect(202,69,13,38)}</g>${bolts(215,139)}`,
 cabinet: `${rect(0,0,140,175,'body',4)}${rect(7,7,126,161)}<g class="detail">${line('M 70 7 V 168')}${rect(16,18,42,25)}${rect(23,25,28,11)}${rect(82,18,40,25)}${line('M 58 71 V 102 M 83 71 V 102')}${vents(18,120,5)}${vents(87,120,5)}${line('M 55 5 H 85 M 8 174 V 183 H 132 V 174')}${line('M 29 53 L 19 72 H 30 L 24 88 L 44 65 H 33 Z','electrical')}${circle(100,57,4)}</g>`,
 smallWrapper: `${rect(0,18,230,112,'body',4)}${rect(49,5,141,138)}<g class="detail">${rect(57,13,125,122)}${rect(88,30,72,72)}${rect(98,40,52,52)}${roller(26,52,20)}${roller(26,104,19)}${line('M 22 74 H 54 M 43 52 H 88 M 45 104 H 87 M 64 19 V 125 M 74 19 V 125')}${vents(194,44,8)}${rect(14,145,42,13)}${rect(199,6,22,12)}${line('M 76 132 H 163')}${rect(171,42,11,58)}</g>${bolts(230,130)}`,
 hardPacker: `${rect(0,28,255,130,'body',4)}${rect(53,4,147,177)}<g class="detail">${rect(61,12,131,161)}${rect(72,22,109,35)}${line('M 80 28 V 51 M 91 28 V 51 M 102 28 V 51 M 113 28 V 51 M 124 28 V 51 M 135 28 V 51 M 146 28 V 51 M 157 28 V 51 M 168 28 V 51')}${roller(124,113,40)}${circle(124,113,25)}${line('M 96 85 L 152 141 M 96 141 L 152 85')}${rect(12,42,32,102)}${vents(15,52,10)}${rect(209,47,34,87)}${rect(210,58,31,18)}${rect(87,184,63,14)}${line('M 5 151 H 47 M 203 151 H 249')}</g>`,
 outerWrapper: `${rect(0,13,285,125,'body',4)}${rect(84,0,173,152)}<g class="detail">${rect(93,9,154,134)}${rect(137,32,95,87)}${rect(149,43,70,65)}${roller(43,47,28)}${roller(43,105,25)}${line('M 70 47 H 136 M 66 105 H 136 M 102 19 V 131 M 113 19 V 131 M 124 19 V 131 M 263 27 V 126 M 271 27 V 126 M 279 27 V 126')}${rect(152,157,49,13)}${rect(4,145,53,15)}${line('M 146 117 H 233')}</g>${bolts(285,138)}`,
}
const simpleShapes = {
 maker: `<g class="simple">${roller(56,151,27)}${rect(117,120,21,63)}${rect(149,120,21,63)}${roller(240,56,23)}${rect(220,116,44,69)}</g>`,
 packer: `<g class="simple">${rect(44,17,54,48)}${roller(105,111,29)}${rect(180,22,16,105)}</g>`,
 cabinet: `<g class="simple">${line('M 70 7 V 168 M 58 71 V 102 M 83 71 V 102')}${rect(16,18,42,25)}${line('M 29 53 L 19 72 H 30 L 24 88 L 44 65 H 33 Z','electrical')}</g>`,
 smallWrapper: `<g class="simple">${roller(26,52,19)}${roller(26,104,18)}${rect(88,30,72,72)}${rect(194,44,24,70)}</g>`,
 hardPacker: `<g class="simple">${rect(72,22,109,35)}${roller(124,113,37)}${rect(209,47,34,87)}</g>`,
 outerWrapper: `<g class="simple">${roller(43,47,26)}${roller(43,105,24)}${rect(137,32,95,87)}</g>`,
}
for (const key of Object.keys(symbols)) symbols[key] += simpleShapes[key]

// Physical placement follows the supplied site layout. Footprints remain simplified.
symbols.maker = `${line('M 0 0 H 400 V 355 H 270 V 140 H 0 Z','body')}${rect(8,8,252,122)}${rect(278,8,114,339)}<g class="detail">${roller(63,70,43)}${rect(119,22,59,96)}${rect(189,22,60,96)}${rect(129,35,38,68)}${rect(199,35,38,68)}${roller(335,69,40)}${rect(293,130,83,109)}${rect(306,145,56,79)}${roller(335,292,36)}${line('M 278 118 H 392 M 278 249 H 392')}${rect(258,31,13,74)}</g><g class="simple">${roller(63,70,38)}${rect(119,22,59,96)}${rect(189,22,60,96)}${roller(335,69,36)}${rect(299,140,73,91)}${roller(335,292,32)}</g>`
symbols.verticalPacker = `${rect(0,0,155,322,'body',7)}${rect(8,8,139,306)}<g class="detail">${rect(20,20,115,78)}${roller(77,59,29)}${rect(20,109,115,93)}${rect(31,122,93,65)}${rect(20,215,115,86)}${line('M 31 228 H 122 M 31 239 H 122 M 31 250 H 122 M 31 261 H 122 M 31 272 H 122 M 31 283 H 122')}${rect(-9,38,17,34)}${rect(-9,250,17,34)}</g><g class="simple">${roller(77,59,29)}${rect(20,109,115,93)}${rect(20,215,115,86)}</g>`
symbols.verticalWrapper = '<g transform="translate(0 230) rotate(-90)"><use href="#shape-smallWrapper"/></g>'
const machines = [
 {id:'ZJ117',name:'卷接机',x:1340,y:130,shape:'maker',sx:1,sy:1,w:400,h:355,lx:1535,ly:97},
 {id:'YB25',name:'小盒包装机',x:555,y:136,shape:'packer',sx:1.65,sy:.84,w:355,h:150,lx:730,ly:100},
 {id:'MAIN-CABINET',name:'主电柜',x:170,y:325,shape:'cabinet',sx:1.25,sy:.8,w:175,h:146,lx:257,ly:304},
 {id:'YB95',name:'条外透明纸包装机',x:170,y:590,shape:'outerWrapper',sx:1.22,sy:.83,w:348,h:142,lx:340,ly:552},
 {id:'YB65',name:'硬条包装机',x:555,y:583,shape:'hardPacker',sx:.95,sy:.72,w:242,h:143,lx:676,ly:552},
 {id:'YB55',name:'小盒透明纸包装机',x:654,y:750,shape:'verticalWrapper',sx:1,sy:1,w:158,h:230,lx:950,ly:850},
]
const variants = [
 {file:'01-real-dark',title:'A · 实际布局 / 深色机械线稿',bg:'#101c18',grid:'#20382e',stroke:'#9bb9a9',part:'#172b22',body:'#1c3329',accent:'#78d4ad',text:'#edf6f0',muted:'#91ab9e',belt:'#2b4639',detail:true},
 {file:'02-real-light',title:'B · 实际布局 / 浅色工程图',bg:'#f7fafc',grid:'#e1e9ef',stroke:'#42627b',part:'#f5f9fc',body:'#e8f0f6',accent:'#287f99',text:'#19384d',muted:'#638194',belt:'#d8e5ee',detail:true},
 {file:'03-real-flat',title:'C · 实际布局 / 扁平设备轮廓',bg:'#f5f8f5',grid:'#e9efea',stroke:'#507767',part:'#f0f7f2',body:'#dbece1',accent:'#278e65',text:'#213d30',muted:'#6f8779',belt:'#ccddd2',detail:false},
]
const belts = ['M 1340 200 H 1194','M 1046 200 H 910','M 555 200 H 89 Q 69 200 69 220 V 939 Q 69 959 89 959 H 681','M 728 750 V 706','M 555 650 H 518']
const arrows = ['M 1293 200 H 1234','M 1008 200 H 952','M 441 200 H 383','M 252 200 H 188','M 69 485 V 545','M 69 714 V 774','M 167 959 H 225','M 360 959 H 418','M 565 959 H 630','M 728 743 V 716','M 546 650 H 525']
for (const variant of variants) {
 const css = `text{font-family:'Microsoft YaHei','PingFang SC',Arial,sans-serif}.body{fill:${variant.body};stroke:${variant.stroke};stroke-width:2}.part{fill:${variant.part};stroke:${variant.stroke};stroke-width:1.5}.detail{fill:none;stroke:${variant.stroke};stroke-width:1.25;${variant.detail?'':'display:none'}}.detail .part{fill:${variant.part}}.simple{display:${variant.detail?'none':'inline'};fill:none;stroke:${variant.stroke};stroke-width:1.6}.simple .detail{display:inline}.simple .part{fill:${variant.part}}.electrical{fill:none;stroke:${variant.accent};stroke-width:1.6}.label{fill:${variant.text};font-size:24px;font-weight:650;letter-spacing:.6px}.name{fill:${variant.muted};font-size:17px}.note{fill:${variant.muted};font-size:15px}.title{fill:${variant.text};font-size:25px;font-weight:600}.flow{fill:none;stroke:${variant.accent};stroke-width:3;marker-end:url(#arrow)}`
 const defs = `<defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 H 0 V 24" fill="none" stroke="${variant.grid}" stroke-width=".6"/></pattern><marker id="arrow" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 1 L 11 6 L 0 11 Z" fill="${variant.accent}"/></marker>${Object.entries(symbols).map(([id,shape])=>`<g id="shape-${id}">${shape}</g>`).join('')}</defs>`
 const conveyor = belts.map(d=>`<path d="${d}" fill="none" stroke="${variant.stroke}" stroke-width="24" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${variant.part}" stroke-width="21" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${variant.stroke}" stroke-width="17" stroke-dasharray="1 7" stroke-linejoin="round"/>`).join('')
 const equipment = machines.map(machine => {
  const target = productionLineTarget(machine.id)
  const tag = target ? 'a' : 'g'
  const link = target ? ` class="machine-link" data-machine="${machine.id}" href="/#/monitor?machine=${encodeURIComponent(target.query.machine)}" target="_top" aria-label="${machine.id} ${machine.name}"` : ''
  return `<${tag} id="machine-${machine.id}" data-device="${machine.id}"${link}><title>${machine.id==='MAIN-CABINET'?'主电柜':machine.id+' '+machine.name}</title>${target ? `<rect x="${machine.x-6}" y="${machine.y-6}" width="${Math.max(machine.w, machine.lx + 110 - machine.x)+12}" height="${machine.h+12}" fill="transparent" stroke="none" pointer-events="all"/>` : ''}<g transform="translate(${machine.x} ${machine.y}) scale(${machine.sx} ${machine.sy})"><use href="#shape-${machine.shape}"/></g>${text(machine.lx,machine.ly,machine.id==='MAIN-CABINET'?'主电柜':machine.id)}${machine.id==='MAIN-CABINET'?'':text(machine.lx,machine.ly+25,machine.name,'name')}</${tag}>`
 }).join('')
 const buffer = `<g id="storage-drum" data-device="STORAGE-DRUM"><title>储烟滚筒</title><circle cx="1120" cy="200" r="74" fill="${variant.part}" stroke="${variant.stroke}" stroke-width="2"/><circle cx="1120" cy="200" r="66" fill="none" stroke="${variant.stroke}" stroke-width="1"/><g class="detail"><path d="M 1062 171 Q 1120 146 1178 171 M 1062 229 Q 1120 254 1178 229 M 1090 146 V 254 M 1150 146 V 254"/></g><rect x="1060" y="178" width="120" height="44" rx="5" fill="${variant.part}"/>${text(1120,207,'储烟滚筒','name')}</g>`
 const content = `<rect width="1800" height="1030" fill="${variant.bg}"/><rect x="35" y="40" width="1730" height="965" rx="8" fill="url(#grid)" stroke="${variant.grid}"/><g id="conveyors">${conveyor}</g>${equipment}${buffer}<g id="material-flow">${arrows.map(d=>line(d,'flow')).join('')}</g>`
 const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1030" viewBox="0 0 1800 1030" role="img" aria-labelledby="drawing-title drawing-desc"><title id="drawing-title">${variant.title}</title><desc id="drawing-desc">右上 ZJ117 呈向下延伸的 L 形，左接储烟滚筒，再左接 ZB25。主电柜在左上空位。ZB25 出口沿最左侧下行，从底部接入竖向 YB55。YB55 向上垂直接入横向 YB65，YB65 与左侧 YB95 在同一直线上。</desc><style>${css}</style>${defs}${content}</svg>`
 await fs.writeFile(path.join(output,variant.file+'.svg'),svg)
 const publicOutput = path.resolve(output, '../../public/production-line')
 await fs.mkdir(publicOutput, { recursive: true })
 await fs.writeFile(path.join(publicOutput, variant.file+'.svg'), svg.replace('</style>', `.machine-link{cursor:pointer;outline:none;text-decoration:none}.machine-link:hover .body,.machine-link:focus-visible .body{stroke:${variant.accent};stroke-width:3}.machine-link:hover text,.machine-link:focus-visible text{fill:${variant.accent}}</style>`))
 await sharp(Buffer.from(svg)).png().toFile(path.join(output,variant.file+'.png'))
 console.log(variant.file)
}



