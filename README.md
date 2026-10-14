# 智能设备健康管理平台大屏

基于 Vue 3、Vite、ECharts 和 lucide-vue-next 实现的静态数字化大屏原型。

## 本地运行

开发和构建均使用真实后端数据，需要后端服务可用并使用真实账号登录。

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 登录 API 配置

复制 `.env.example` 为 `.env.local`，通过 `VITE_LOGIN_API_URL` 指定完整登录接口地址（含路径），例如：

```dotenv
VITE_LOGIN_API_URL=http://66.66.66.4:18080/auth/login
```

也可使用同源路径，例如 `VITE_LOGIN_API_URL=/auth/login`，由部署服务器转发请求。留空时沿用 `VITE_NEW_API_BASE_URL` 对应服务的 `/auth/login`；开发环境未配置该服务地址时使用 `VITE_DEV_NEW_API_BASE_URL`，生产环境未配置时跟随页面主机并使用 18080 端口。登录仍以 POST 表单提交账号和密码，不携带已有登录令牌。

开发环境修改 `.env` 后须重启 Vite。生产环境可通过 `.env.production` 设置部署地址，修改后须重新构建并部署；直接修改已部署静态文件旁的 `.env` 不会生效。不要将账号、密码或令牌放入 `VITE_*` 配置。

## 数据展示大屏

登录后通过侧栏“数据展示大屏”进入 `/#/data-screen`。大屏沿用亮暗主题，自动隐藏侧栏并压缩顶部导航，以九区网格展示采集模块、全部点位实时值、所选点位曲线、系统检查与管道、数据表分区与缓存、硬限值和趋势报警、原始历史数据、每日限值趋势及趋势洞察。仅使用 5158 采集服务，不请求声纹设备、录音或频谱服务，也不发送其登录令牌。

实时采样每 2 秒刷新，总览、点位元数据及分析每 60 秒刷新；支持暂停、手动刷新、点位搜索与切换，并复用顶部主题与全屏按钮。曲线只积累本次访问的真实采样；历史默认查询最近 10 分钟（最多 5000 条），趋势与洞察查询最近 30 天，每类报警最多 1000 条，达到上限时提示可能截断。面板内部滚动展示全部已获取记录，点击模块、检查、数据表、报警及详情按钮查看完整字段。各来源显示成功更新时间，失败保留旧数据并提示；离开页面停止定时器并取消请求。大屏优先适配 1366×768 及以上桌面，较小高度采用网格内部滚动。

运行环境须满足 Vite 的 Node 要求（例如 Node 22.12+ 的 22 系列）。Windows 安装使用 `npm ci --include=optional`，确保 Rolldown 原生依赖完整。

## 说明

- 页面入口：`src/App.vue`
- 图表封装：`src/components/EChart.vue`
- 全局样式：`src/style.css`
- 首页使用真实健康接口数据，设备监控整合采集与声纹两类业务后端，其他页面按原有接入方式运行。

## 健康状态接入（第一步）

首页请求采集服务的 `GET /api/health`、`GET /api/health/detail`、`GET /api/health/table-maintenance`，同时复用声纹服务的 `GET /monitor/devices`。默认每 15 秒刷新，可暂停或手动刷新，离开首页即停止轮询并取消未完成请求。各业务独立处理，超时为 10 秒。健康详情返回 HTTP 503 时仍展示 JSON 检查结果；请求失败保留上次数据并明确提示。

本地开发通过 `/_health-api` 同源代理连接 `http://66.66.66.4:5158`，代理仅匹配上述三个健康接口，不转发其他旧接口或 18080 接口。生产环境未配置 `VITE_API_BASE_URL` 时同样请求 `/_health-api`，由 Nginx 转发到 `66.66.66.4:5158`，浏览器不再跨域访问后端。需要直连其他服务器时可复制 `.env.example` 为 `.env.local` 并设置 `VITE_API_BASE_URL`。

`src/services/health.js` 使用独立请求通道，不携带 18080 服务的登录令牌。首页的新设备列表通过现有 `api.getMonitorDevices` 使用 18080 的登录令牌；没有新增监听会话或音频连接。未配置 `VITE_NEW_API_BASE_URL` 时，开发环境通过 Vite、生产环境通过 Nginx 同源代理连接 `66.66.66.4:18080`，避免浏览器跨域请求；监听 WebSocket 和录音地址也使用同一入口。登录、鉴权和其他页面业务接口保持不变。其他旧接口继续由 `VITE_LEGACY_API_DISABLED` 控制，默认停用。

首页展示心跳、检查明细、数据库及点位状态、模块在线状态、历史/聚合表分区、缓存、配置文件和表维护记录。首页不使用静态预览数据；系统健康与模块在线状态分别统计。

首页主视图采用图表布局：检查通过率仪表盘、模块在线环图与可点击状态矩阵、检查分类条形图、分区覆盖热力图、缓存环图、维护前后分区柱状图及数据管道示意。完整表格保留在底部“完整诊断明细”，展开时才加载。不生成模拟趋势，零缓存显示空环，并适配亮暗主题和减少动态效果设置。

设备区域整合 `runtimeModules.statuses[]`（采集模块）与 `/monitor/devices`（声纹设备），总览卡片按两边已获取记录相加，环图与状态矩阵支持全部/采集模块/声纹设备筛选。采集模块使用 `isOnline`，声纹设备使用 `online`，字段缺失计为未知；设备下的网关、通道只展示连接情况，不重复计数。使用来源、协议和字符串 ID 区分记录，未建立跨系统映射前不跨来源去重。每个来源显示更新时间和失败/过期状态，未返回的数据不冒充零设备。健康检查、分区、缓存、点位与队列仍只描述采集服务。

```bash
node --experimental-vm-modules --test tests/*.test.mjs
npm run build
```

## 设备监控接入（第二步）

设备监控按业务整合采集模块和声纹设备，可筛选来源和切换设备。声纹服务继续调用原有 `GET /monitor/devices`，保留网关、通道字段及原鉴权，仅进入页面或手动刷新时获取，不创建监听会话；声纹实时波形仍使用原有频谱分析功能。

采集服务使用独立的 `src/services/telemetry.js`，接入以下四个只读接口，不携带声纹服务令牌：

- `GET /api/configuration/modules`：模块目录每 15 秒刷新。
- `GET /api/configuration/modules/{moduleId}/points?includeLatest=false`：切换模块时获取点位和 `pointId`。
- `GET /api/realtime/latest`：选中采集模块时每 2 秒刷新，可暂停。按模块、通道、点位编码匹配元数据，每个点位保留最近 300 个实际采样时间点，重复时间戳不追加，零值正常显示，超过 15 秒的采样间隔断线显示。折线只积累本次页面访问的数据，不补造历史。
- `GET /api/telemetry/history?pointId=...&start=...&end=...&limit=...`：使用本地时间和 `pointId` 查询原始数据表格。进入历史模式或在历史模式切换点位时，自动查询当前时间之前 10 分钟，默认最多 5000 条；也可手动调整时间范围查询。查询上限为 1–100000，达到上限时提示可能截断。

两套接口分别显示加载错误，不因一侧失败清空另一侧数据。切换点位会清除旧历史，过期请求不能覆盖新选择，离开页面停止轮询并取消请求。

历史查询结果仅用表格展示，包含采集时间、原始精度数值、单位和原始质量值；默认最新优先，支持时间排序与每页 20/50/100 条分页，分页不额外请求后端。实时数据继续使用折线图。

开发和生产环境均使用 `/_telemetry-api` 同源代理，仅匹配上述四个接口；健康代理和声纹服务请求地址不变，也可用 `VITE_API_BASE_URL` 覆盖。其他旧接口仍默认禁用，不影响其他页面现有接入。

## 告警管理接入（第三步）

告警管理包含“采集报警”“趋势报警”“声纹告警”三个具体列表，不再提供合并总览。采集硬限值报警、趋势报警和声纹告警分别查询、分别分页，避免不同业务口径混合统计。

采集报警通过独立 `src/services/alarms.js` 调用 `GET /api/analysis/alarms`，支持可选 `pointId`、`isActive`、`start`、`end` 和 `limit`（默认 200，范围 1–1000），不发送旧的模块/通道组合参数。模块与点位选择复用已迁移的只读元数据服务。默认不限定时段或状态，支持表格分页、阈值/报警值/恢复值详情；达到上限时提示查询可能截断。`GET /api/analysis/status` 展示独立的 Worker 状态，不用内存分析状态替代报警事件。进入页面自动查询，可手动刷新，不新增后台轮询或写操作。

“趋势报警”通过 `GET /api/analysis/trend-alarms` 查询趋势报警事件。页面支持模块、点位、时间、活动状态和返回条数筛选，列表带分页；趋势变化折线图随查询结果同步更新，事件详情点击表格行后以浮层查看。

开发和生产环境中采集报警使用 `/_alarm-api`，趋势接口使用独立 `/_analysis-api` 白名单代理，均由服务器同源转发到采集服务，也可用 `VITE_API_BASE_URL` 覆盖。采集服务请求不携带声纹服务令牌，声纹服务的 `/alarm/page`、录音、样本类别和每日统计继续使用原请求方法、参数及鉴权。

## 趋势分析（第四步）

趋势分析页已接入 `GET /api/analysis/daily-limit-trends` 和 `GET /api/analysis/trend-insights`，按点位、时间范围和聚合分钟查询真实数据，展示每日最小值、均值、最大值、上下限、超限分钟以及后端风险洞察，不再使用静态趋势预览。

2026-09-03 曾对旧地址 `192.168.31.158:5158` 做只读联调：硬限值报警、每日限值趋势、趋势洞察和趋势报警接口均返回 HTTP 200。当前后端地址为 `66.66.66.4`。

使用 `npm run preview` 运行生产构建时，Vite Preview 已配置与开发服务器相同的 5158 白名单代理。修改 `vite.config.js` 后必须停止并重新启动 Preview 进程，仅重新执行 `npm run build` 不会更新正在运行的代理配置。

## Nginx 生产代理

生产站点的 `server` 块需配置以下 5158 白名单。趋势接口使用精确匹配，因此即使现有 SPA 规则写成 `location ^~ /`，也不会把 API 请求回退为 `index.html`。查询参数不参与 Nginx `location` 匹配，无需写入规则。

```nginx
location = /_analysis-api/api/analysis/daily-limit-trends {
    proxy_pass http://66.66.66.4:5158/api/analysis/daily-limit-trends;
    include /etc/nginx/snippets/equipment-api-5158.conf;
}

location = /_analysis-api/api/analysis/trend-insights {
    proxy_pass http://66.66.66.4:5158/api/analysis/trend-insights;
    include /etc/nginx/snippets/equipment-api-5158.conf;
}

location = /_analysis-api/api/analysis/trend-alarms {
    proxy_pass http://66.66.66.4:5158/api/analysis/trend-alarms;
    include /etc/nginx/snippets/equipment-api-5158.conf;
}

location ~ ^/(?:_health-api/api/health(?:/detail|/table-maintenance)?|_telemetry-api/api/(?:configuration/modules(?:/[^/]+/points)?|realtime/latest|telemetry/history)|_alarm-api/api/analysis/(?:alarms|status))$ {
    rewrite ^/_[^/]+(/api/.*)$ $1 break;
    proxy_pass http://66.66.66.4:5158;
    include /etc/nginx/snippets/equipment-api-5158.conf;
}
```

新建 `/etc/nginx/snippets/equipment-api-5158.conf`，内容如下：

```nginx
    proxy_http_version 1.1;
    proxy_set_header Host $proxy_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_cache off;
    proxy_hide_header ETag;
    proxy_hide_header Last-Modified;
    add_header Cache-Control "no-store" always;
    proxy_intercept_errors off;
    proxy_connect_timeout 5s;
    proxy_read_timeout 15s;
    limit_except GET { deny all; }
```

然后在站点的 `server` 块中保留代理前缀兜底：

```nginx
location ~ ^/_(?:health|telemetry|alarm|analysis)-api(?:/|$) {
    return 404;
}
```

修改后依次执行 `nginx -t` 和 `nginx -s reload`。浏览器开发者工具中上述三个趋势接口应显示 `Content-Type: application/json`，响应体应分别包含 `days`、`insight`、`events`；若响应体是 `index.html`，说明请求仍被 SPA 静态规则接管。

### 产线状态监测首页

首页已合入现场 SVG 布局：右上 L 形 ZJ117 经储烟滚筒连接 YB25，左侧输送线接入竖向 YB55；YB55 垂直连接横向 YB65，YB65 与 YB95 在同一直线上。点击机组会同步切换左侧测点列表和右侧全部当前值；左侧按 MAX 风机、VE 风机、主电机等物理监测部位分组，合并该部位的振动、温度和声纹子测量，右侧用文字显示正常、报警或待确认。点击分组进入 `/#/device?location=...` 对应详情页；未确认归属的点位按采集模块保留，并携带原始测点上下文进入 `/#/device/detail`。选中机组显示流水虚线，开启减少动态效果时取消动画。

图纸及几何布局由 `public/production-line/` 的 SVG 管理，监测身份及健康状态分别位于 `src/charts/productionLine.js` 和 `src/charts/productionLineStatus.js`。YB25 沿用原有 ZB25 的模块和采集器归属；YB65、YB95 尚无已确认的数据映射，显示未配置。后续接入需补充确认的模块/采集器映射。

主页及左右卡片保持一屏展示，全部当前值按数量自动分栏，不滚动、不分页；仅告警列表分页。有效当前值在无活动报警且告警来源已成功返回时显示绿色，报警显示黄色；缺值、坏质量、离线或超过 10 秒未更新时显示“—”。声纹通道展示实际连接状态，不生成声纹诊断数值。顶栏专门表示采集设备连接状态：全部已返回的采集模块和声纹设备在线时显示“系统正常”，存在明确离线设备时显示“系统报警”，设备连接数据缺失或获取失败时显示待确认。测量值报警不改变连接状态顶栏，仍在机组、测点和告警列表中独立显示。

点击图中黄色报警状态会按机组过滤下方报警详情；报警与测点通过模块及真实点位标识匹配。告警接口查询上限为 1000 条，达到上限时不据此断言无报警。实时样本每 2 秒刷新，配置、声纹设备和告警每 30 秒刷新；离开首页会取消请求并清理计时器。右上角可暂停刷新、手动刷新或展开主题与账户设置。

### 现场产线图交互预览

访问 `/#/production-line/preview` 可查看已校准的产线图，并切换深色、浅色、扁平三种样式。图中只保留设备名称；ZJ117、YB25、YB55、YB95 支持鼠标和键盘访问对应监测页，YB65、主电柜、储烟滚筒不导航。YB25 对应既有内部标识 ZB25；YB95 入口和空页已准备，尚未分配监测点，不复用其他设备的数据。

导航映射在 `src/charts/productionLineTargets.js`，可复用组件为 `src/components/SiteProductionLinePlan.vue`。SVG 源图在 `public/production-line/`，制图脚本和 PNG 预览在 `artifacts/production-line-real-layout/`。独立预览页保留直接跳转行为；首页使用同一组件的机组选择及报警联动模式。

latest 返回业务 404 时请检查采集服务地址：`VITE_API_BASE_URL` 留空使用 `/_telemetry-api` 同源代理，`VITE_DEV_API_BASE_URL=http://66.66.66.4:5158`。`http://66.66.66.4` 的默认 80 端口不会提供该采集接口；不要将声纹服务或网关地址用作采集服务地址。修改 `.env.local` 后重启开发服务器。固定接口仍为 `GET /api/realtime/latest`，不添加前缀、不修改后端契约、不携带声纹令牌。


### 机组概览的班次详情

点击机组概览测点卡片打开详情弹窗时，默认选中“当班”并立即查询该班次历史数据，不使用页面实时缓冲区作为初始详情。“当班”和“上一班”按钮立即切换并查询；开始、结束时间可编辑，编辑后进入自定义模式，点击查询执行。参数切换沿用当前时间范围并重新加载，关闭弹窗会取消请求，旧查询结果不能覆盖新查询。

班次沿用现有规则：早班 09:30–18:00，晚班 18:00–次日 02:00；02:00–09:30 期间当班指最近开始的晚班。班次详情请求完整的班次区间，显示后端已产生的数据，达到 100000 条接口查询上限时提示缩短范围。采集历史接口路径和参数约定保持不变；声纹测点默认查询同一班次区间内的录音。

### 机台指标与报警颜色

首页产线图上方展示“86#机台”和四个指标，并压缩图纸区域，保持整页及当前值卡片无滚动。小盒产量、不合格数、NG 占比尚未接入，显示“—”。剔除状态使用现有 `PRESS01 / PRESS01-DI02 / PRESS01_DI02` 的“小包外观剔除按钮”信号，明确显示“按钮已触发 / 按钮未触发”；无有效实时样本时显示“—”，不将按钮信号解释为执行机构的实际状态。

首页告警列表和告警管理页提供“颜色设置”，支持黄色、红色，覆盖优先级为单条报警、警种、报警级别。配置按账户保存在当前浏览器，可恢复默认；仅改变显示，不修改报警级别、阈值或后端数据。严重报警默认红色，预警默认黄色，两种主题均提供对应的文字颜色。
