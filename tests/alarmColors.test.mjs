import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { alarmColorName, alarmRuleKey } from '../src/charts/alarmColors.js'
import { useAlarmColorsStore } from '../src/stores/alarmColors.js'

test('alarm color defaults and overrides prefer individual alarm, then kind, then severity',()=>{
 const event={alarmId:'a',severity:'Critical',metricType:'Temperature'}
 assert.equal(alarmColorName(event),'red')
 assert.equal(alarmColorName({...event,severity:'Warning'}),'yellow')
 const rules={[alarmRuleKey('severity',event)]:'yellow',[alarmRuleKey('kind',event)]:'red',[alarmRuleKey('alarm',event)]:'yellow'}
 assert.equal(alarmColorName(event,rules),'yellow')
 delete rules[alarmRuleKey('alarm',event)];assert.equal(alarmColorName(event,rules),'red')
 assert.equal(alarmColorName(event,{[alarmRuleKey('alarm',event)]:'blue'}),'red')
})

test('alarm colors persist per account without changing server alarm data',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');const saved=new Map()
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,String(value))}})
 try{
 setActivePinia(createPinia());const store=useAlarmColorsStore();const event={alarmId:'a',severity:'Warning'};const key=alarmRuleKey('alarm',event)
 localStorage.setItem('equipment_dashboard_user',JSON.stringify({username:'userA'}));store.ensureUser();store.save(key,'red');assert.ok(store.color(event).includes('red'))
 localStorage.setItem('equipment_dashboard_user',JSON.stringify({username:'userB'}));store.ensureUser();assert.ok(store.color(event).includes('yellow'))
 localStorage.setItem('equipment_dashboard_user',JSON.stringify({username:'userA'}));store.ensureUser();assert.ok(store.color(event).includes('red'));store.save(key,'');assert.ok(store.color(event).includes('yellow'));assert.equal(event.severity,'Warning')
 }finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage}
})
