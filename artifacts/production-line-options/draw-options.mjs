import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sharp = require('C:/Users/14116/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')
const output = 'C:/Users/14116/WebstormProjects/xinjiang_smart_equipment_dashboard/artifacts/production-line-options'
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
const machines = [
 {id:'YB95',name:'条外透明纸包装机',x:190,y:195,shape:'outerWrapper',w:285,h:170,labelY:144},
 {id:'YB65',name:'硬条包装机',x:645,y:175,shape:'hardPacker',w:255,h:198,labelY:124},
 {id:'ZJ117',name:'卷接机 · L 形机组',x:1230,y:410,shape:'maker',w:302,h:233,labelY:364},
 {id:'YB25',name:'小盒包装机',x:915,y:475,shape:'packer',w:215,h:179,labelY:424},
 {id:'MAIN-CABINET',name:'主电柜',x:685,y:470,shape:'cabinet',w:140,h:183,labelY:442},
 {id:'YB55',name:'小盒透明纸包装机',x:675,y:780,shape:'smallWrapper',w:230,h:158,labelY:976,bottom:true},
]
const variants = [
 {file:'01-dark-mechanical',title:'方案 A · 深色机械线稿',bg:'#101c18',grid:'#20382e',stroke:'#9bb9a9',part:'#172b22',body:'#1c3329',accent:'#78d4ad',text:'#edf6f0',muted:'#91ab9e',belt:'#2b4639',detail:true},
 {file:'02-light-engineering',title:'方案 B · 浅色工程图',bg:'#f7fafc',grid:'#e1e9ef',stroke:'#42627b',part:'#f5f9fc',body:'#e8f0f6',accent:'#287f99',text:'#19384d',muted:'#638194',belt:'#d8e5ee',detail:true},
 {file:'03-flat-silhouette',title:'方案 C · 扁平设备轮廓',bg:'#f5f8f5',grid:'#e9efea',stroke:'#507767',part:'#f0f7f2',body:'#dbece1',accent:'#278e65',text:'#213d30',muted:'#6f8779',belt:'#ccddd2',detail:false},
]
const belts = [
 'M 1230 555 H 1130',
 'M 1039 641 V 841 H 905',
 'M 865 785 V 375 H 946 V 268 H 900',
 'M 645 268 H 475',
 'M 190 268 H 112',
]
const arrows = ['M 1210 555 H 1165','M 1039 679 V 726','M 1039 768 V 815','M 1011 841 H 930','M 865 737 V 688','M 865 577 V 529','M 865 438 V 399','M 895 375 H 929','M 946 323 V 286','M 603 268 H 544','M 164 268 H 125']
for (const variant of variants) {
 const css = `.simple{display:${variant.detail?'none':'inline'};fill:none;stroke:${variant.stroke};stroke-width:1.6}.simple .detail{display:inline}.simple .part{fill:${variant.part}}text{font-family:'Microsoft YaHei','PingFang SC',Arial,sans-serif} .body{fill:${variant.body};stroke:${variant.stroke};stroke-width:${variant.detail?2:2.5}} .part{fill:${variant.part};stroke:${variant.stroke};stroke-width:1.6} .detail{fill:none;stroke:${variant.stroke};stroke-width:1.3;${variant.detail?'':'display:none'}} .detail .part{fill:${variant.part}} .electrical{fill:none;stroke:${variant.accent};stroke-width:1.6} .label{fill:${variant.text};font-size:24px;font-weight:650;letter-spacing:1px} .name{fill:${variant.muted};font-size:18px} .note{fill:${variant.muted};font-size:15px} .title{fill:${variant.text};font-size:26px;font-weight:600} .subtitle{fill:${variant.muted};font-size:15px} .flow{fill:none;stroke:${variant.accent};stroke-width:3;marker-end:url(#arrow)} .sensor{fill:${variant.bg};stroke:${variant.accent};stroke-width:2} .sensor-core{fill:${variant.accent}}` 
 const defs = `<defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 H 0 V 24" fill="none" stroke="${variant.grid}" stroke-width=".65"/></pattern><pattern id="rollers" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M 0 0 V 9" stroke="${variant.stroke}" stroke-width=".7"/></pattern><marker id="arrow" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 1 L 11 6 L 0 11 Z" fill="${variant.accent}"/></marker>${Object.entries(symbols).map(([id,shape])=>`<g id="shape-${id}">${shape}</g>`).join('')}</defs>`
 const conveyor = belts.map(d=>`<g><path d="${d}" fill="none" stroke="${variant.stroke}" stroke-width="28" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${variant.part}" stroke-width="25" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${variant.belt}" stroke-width="18" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${variant.stroke}" stroke-width="17" stroke-dasharray="1 7" stroke-linejoin="round"/></g>`).join('')
 const equipment = machines.map(machine=>`<g id="machine-${machine.id}" data-device="${machine.id}"><title>${machine.id==='MAIN-CABINET'?'主电柜':machine.id+' '+machine.name}</title><g transform="translate(${machine.x} ${machine.y})"><use href="#shape-${machine.shape}"/></g>${text(machine.x+machine.w/2,machine.labelY,machine.id==='MAIN-CABINET'?'主电柜':machine.id)}${machine.id==='MAIN-CABINET'?'':text(machine.x+machine.w/2,machine.bottom?machine.labelY+27:machine.labelY+28,machine.name,'name')}${machine.id==='MAIN-CABINET'?'':`<g transform="translate(${machine.x+machine.w*.36} ${machine.y+machine.h-2})"><circle class="sensor" r="7"/><circle class="sensor-core" r="3"/></g>`}</g>`).join('')
 const content = `<rect width="1600" height="1040" fill="${variant.bg}"/><rect x="36" y="95" width="1528" height="915" rx="8" fill="url(#grid)" stroke="${variant.grid}"/>${text(48,48,variant.title,'title','start')}${text(48,77,'ZJ117 → YB25 → YB55 → YB65 → YB95','subtitle','start')}${text(1548,49,'产线俯视 · 布局预览','subtitle','end')}${conveyor}${equipment}<g id="material-flow">${arrows.map(d=>line(d,'flow')).join('')}</g><g id="power-connection"><path d="M 825 555 H 902" fill="none" stroke="${variant.muted}" stroke-width="1.8" stroke-dasharray="5 6"/>${text(827,688,'主电柜位于 YB25 左侧','note','end')}${text(1120,752,'小盒输送','note')}${text(552,311,'YB65 左侧出口','note')}</g>${text(1244,659,'L 形机组占位轮廓','note','start')}<g transform="translate(1160 934)"><circle class="sensor" cx="0" cy="0" r="7"/><circle class="sensor-core" r="3"/>${text(17,5,'监测点示意','note','start')}<path d="M 0 30 H 36" stroke="${variant.muted}" stroke-width="1.8" stroke-dasharray="5 5"/>${text(47,35,'电柜连接','note','start')}</g>${text(48,1027,'机械轮廓与输送路径为简化示意 · 非等比例 · 不表示实时运行状态','subtitle','start')}`
 const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1040" viewBox="0 0 1600 1040" role="img" aria-labelledby="drawing-title drawing-desc"><title id="drawing-title">${variant.title}</title><desc id="drawing-desc">右侧 ZJ117 L 形卷接机；左侧 YB25；YB25 左侧主电柜；主电柜下方 YB55 小盒透明纸包装机；YB55 上方对接 YB65 硬条包装机；YB65 左侧出口对接 YB95 条外透明纸包装机。输送连接为示意。</desc><style>${css}</style>${defs}${content}</svg>`
 await fs.writeFile(path.join(output,variant.file+'.svg'),svg)
 await sharp(Buffer.from(svg)).png().toFile(path.join(output,variant.file+'.png'))
 console.log(variant.file)
}

