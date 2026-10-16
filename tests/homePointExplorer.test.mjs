import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import {parse,compileScript} from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as telemetry from '../src/charts/telemetry.js'
import * as catalog from '../src/charts/equipmentCatalog.js'
import * as machines from '../src/charts/machineGroups.js'
import * as shifts from '../src/charts/shiftRange.js'

test('explorer immediately loads current shift, switches ranges and ignores cancelled late results', async()=>{
 for (const embedded of [false, true]) {
 const hooks=[],calls=[],pending=[]
 const limitCalls=[]
 let limitReply=()=>Promise.resolve({moduleId:'VSE03',points:[{pointId:42,minimumValue:0,maximumValue:1.2}]})
 const dependencies={'element-plus':{ElDrawer:{}},vue:{...vue,onMounted:callback=>hooks.push(callback)},'../services/telemetry':{telemetryApi:{getModulePoints(moduleId,options){limitCalls.push({moduleId,signal:options.signal});return limitReply()},getHistory(query,options){calls.push({query,signal:options.signal});return new Promise(resolve=>pending.push(resolve))}}},'../services/api':{api:{}},'../charts/telemetry':telemetry,'../charts/equipmentCatalog.js':catalog,'../charts/machineGroups.js':machines,'../charts/shiftRange.js':shifts}
 const context=vm.createContext({Date,AbortController,window:{innerWidth:1400,innerHeight:900,addEventListener(){},removeEventListener(){}},document:{activeElement:null}})
 const compiled=compileScript(parse(await readFile(new URL('../src/components/HomePointExplorer.vue',import.meta.url),'utf8')).descriptor,{id:'explorer-test'})
 const module=new vm.SourceTextModule(compiled.content,{context})
 await module.link(specifier=>{const exports=specifier.endsWith('.vue')?{default:{}}:dependencies[specifier];assert.ok(exports,specifier);return new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value)},{context})});await module.evaluate()
 const renderer=vue.createRenderer({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},patchProp(){},insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null})
 const component=module.namespace.default;component.render=()=>vue.h('div')
 const point={moduleId:'VSE03',channelId:'ch1',pointCode:'v',pointId:42,metricType:'VibrationRms'}
 const app=renderer.createApp(component,{row:{member:{source:'legacy',id:'VSE03'},point},buffers:{},paused:false,embedded,historicalOnly:embedded})
 const state=app.mount({}).$.setupState
 try{
  await hooks[0]();for(let i=0;i<5;i++)await vue.nextTick()
  assert.equal(state.queryMode,'current');assert.equal(state.live,false);assert.equal(calls.length,1);assert.equal(calls[0].query.start,state.start);assert.equal(calls[0].query.end,state.end);assert.equal(calls[0].query.limit,100000)
  assert.equal(state.limits.minimumValue,0);assert.equal(state.limits.maximumValue,1.2)
  assert.deepEqual(state.option.series[0].markLine.data.map(item=>item.yAxis),[0,1.2])
  state.selectRange('previous');assert.equal(calls.length,2);assert.equal(calls[0].signal.aborted,true)
  const sample=start=>({...point,value:7,collectedAt:new Date(Date.parse(start)+60000).toISOString()})
  pending[0]({pointId:42,points:[sample(calls[0].query.start)]});for(let i=0;i<5;i++)await vue.nextTick();assert.equal(state.history.length,0)
  pending[1]({pointId:42,points:[sample(calls[1].query.start)]});for(let i=0;i<5;i++)await vue.nextTick();assert.equal(state.history.length,1)
  state.selectRange('custom');state.start='2026-10-01T10:00:00';state.end='2026-10-01T11:00:00';state.query();assert.equal(calls[2].query.start,'2026-10-01T10:00:00')
  const limitPending=[]
  limitReply=()=>new Promise(resolve=>limitPending.push(resolve))
  const old=state.loadLimits(),fresh=state.loadLimits()
  assert.equal(limitCalls.at(-2).signal.aborted,true)
  limitPending[1]({moduleId:'VSE03',points:[{pointId:42,minimumValue:null,maximumValue:2.5}]});await fresh
  limitPending[0]({moduleId:'VSE03',points:[{pointId:42,minimumValue:99,maximumValue:100}]});await old
  assert.equal(state.limits.minimumValue,null);assert.equal(state.limits.maximumValue,2.5)
  assert.deepEqual(state.option.series[0].markLine.data.map(item=>item.yAxis),[2.5])
  limitReply=()=>Promise.reject(new Error('offline'))
  await state.loadLimits();assert.match(state.limitsError,/offline/);assert.equal(state.limits,null)
  assert.equal(state.option.series[0].markLine.data.length,0)
 }finally{app.unmount()}
 assert.equal(limitCalls.at(-1).signal.aborted,true)
 assert.equal(calls.at(-1).signal.aborted,true)
 pending.at(-1)({pointId:42,points:[]});for(let i=0;i<5;i++)await vue.nextTick()
 }
})
