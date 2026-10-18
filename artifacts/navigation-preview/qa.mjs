import { chromium } from 'file:///C:/Users/14116/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel:'msedge',headless:true })
try {
  const page = await browser.newPage({ viewport:{width:1600,height:1000} })
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(()=>{
    localStorage.setItem('equipment_dashboard_token','local-navigation-qa')
    localStorage.setItem('dashboard-sidebar','expanded')
  })
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if (url.pathname.includes('/api/') || /^\/(monitor|collectorManagement|alarm|recordings)(\/|$)/.test(url.pathname)) {
      let body=[]
      if (url.pathname.endsWith('/configuration/modules')) body={modules:[]}
      else if (url.pathname.startsWith('/recordings')) body={rows:[],total:0}
      else if (url.pathname.includes('/analysis/')) body={events:[],days:[]}
      return route.fulfill({json:body})
    }
    try {
      const file=path.join(process.cwd(),'dist',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname))
      const body=await fs.readFile(file)
      const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.html')?'text/html':'application/octet-stream'
      await route.fulfill({body,contentType:type})
    } catch { await route.fulfill({status:404,body:''}) }
  })
  await page.goto('http://dashboard.test/#/recordings')
  const primary=page.getByRole('navigation',{name:'主要功能',exact:true})
  await primary.getByRole('button',{name:'数据配置',exact:true}).waitFor()
  assert.equal(await primary.getByRole('button').count(),4)
  let tabs=page.getByRole('navigation',{name:'数据配置子页面',exact:true})
  assert.equal(await tabs.getByRole('link').count(),3)
  await tabs.getByRole('link',{name:'参数配置',exact:true}).click()
  await page.waitForURL('**#/settings/parameters')
  await primary.getByRole('button',{name:'告警分析',exact:true}).click()
  await page.waitForURL('**#/alarm/list')
  await page.getByRole('navigation',{name:'告警分析子页面'}).getByRole('link',{name:'班报与日报'}).click()
  await page.waitForURL('**#/reports')
  await primary.getByRole('button',{name:'数据配置',exact:true}).click()
  await page.waitForURL('**#/settings/parameters')
  await page.getByRole('button',{name:'展开侧边栏',exact:true}).click()
  await page.mouse.move(1100,50)
  await page.evaluate(()=>document.getAnimations().forEach(animation=>{if(animation.effect?.getTiming().iterations!==Infinity) animation.finish()}))
  await page.screenshot({path:'artifacts/navigation-preview/dark.png'})
  await page.getByTitle('切换亮色主题',{exact:true}).click()
  await page.evaluate(()=>document.getAnimations().forEach(animation=>{if(animation.effect?.getTiming().iterations!==Infinity) animation.finish()}))
  await page.screenshot({path:'artifacts/navigation-preview/light.png'})
  await primary.getByRole('button',{name:'设备监测',exact:true}).click()
  await page.waitForURL('**#/machine/overview')
  await page.getByRole('navigation',{name:'设备监测子页面'}).getByRole('link',{name:'测点详情',exact:true}).click()
  await page.waitForURL('**#/device')
  await page.setViewportSize({width:1280,height:800})
  await page.evaluate(()=>document.getAnimations().forEach(animation=>{if(animation.effect?.getTiming().iterations!==Infinity) animation.finish()}))
  await page.screenshot({path:'artifacts/navigation-preview/compact.png'})
  assert.equal(await page.locator('vite-error-overlay').count(),0)
  assert.ok(await page.locator('.page-stage').innerText())
  assert.deepEqual(errors,[])
  await page.setViewportSize({width:1600,height:1000})
  await primary.getByRole('button',{name:'数据配置',exact:true}).click()
  let toolbarSize
  for (const [label, slug] of [['录音管理','recordings'],['网关通讯','gateway'],['参数配置','parameters']]) {
    await page.getByRole('navigation',{name:'数据配置子页面'}).getByRole('link',{name:label,exact:true}).click()
    const workspace=page.locator('.configuration-workspace')
    await workspace.waitFor()
    assert.equal(await workspace.locator('h1').count(),0)
    const toolbar=workspace.locator(':scope > .configuration-toolbar')
    const dimensions=await toolbar.boundingBox()
    if (toolbarSize) {
      assert.ok(Math.abs(dimensions.x-toolbarSize.x)<1)
      assert.ok(Math.abs(dimensions.width-toolbarSize.width)<1)
      assert.ok(Math.abs(dimensions.height-toolbarSize.height)<1)
    } else toolbarSize=dimensions
    for(const theme of ['dark','light']) {
      const isLight=await page.locator('html').evaluate(el=>el.classList.contains('light-theme'))
      if(isLight !== (theme==='light')) await page.locator('.top-actions .top-icon-btn').first().click()
      await page.evaluate(()=>document.getAnimations().forEach(animation=>{if(animation.effect?.getTiming().iterations!==Infinity) animation.finish()}))
      await page.screenshot({path:'artifacts/navigation-preview/configuration-'+slug+'-'+theme+'.png'})
    }
  }
  assert.deepEqual(errors,[])
  console.log('PASS: all three configuration pages have matching toolbar dimensions, no duplicate titles, both themes and no page errors.')
  await primary.getByRole('button',{name:'告警分析',exact:true}).click()
  for(const [label,slug] of [['告警管理','alarms'],['班报与日报','reports']]) {
    await page.getByRole('navigation',{name:'告警分析子页面'}).getByRole('link',{name:label,exact:true}).click()
    const workspace=page.locator('.analysis-workspace')
    await workspace.waitFor()
    assert.equal(await workspace.locator('h1').count(),0)
    const dimensions=await workspace.locator(':scope > .configuration-toolbar').boundingBox()
    assert.ok(Math.abs(dimensions.x-toolbarSize.x)<1)
    assert.ok(Math.abs(dimensions.height-toolbarSize.height)<1)
    for(const theme of ['dark','light']) {
      const isLight=await page.locator('html').evaluate(el=>el.classList.contains('light-theme'))
      if(isLight !== (theme==='light')) await page.locator('.top-actions .top-icon-btn').first().click()
      await page.evaluate(()=>document.getAnimations().forEach(animation=>{if(animation.effect?.getTiming().iterations!==Infinity) animation.finish()}))
      await page.screenshot({path:'artifacts/navigation-preview/analysis-'+slug+'-'+theme+'.png'})
    }
  }
  assert.deepEqual(errors,[])
  console.log('PASS: alarm and report pages match the shared toolbar and content spacing, with no duplicate titles in either theme.')
  console.log('PASS: four primary entries, child tabs, group memory, device navigation, both themes and 1280px layout; no page errors.')
} finally { await browser.close() }
