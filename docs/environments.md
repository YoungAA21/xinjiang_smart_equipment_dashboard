# 环境配置、构建与 Nginx 部署

## 三套环境

| 环境 | 启动 | 构建 | 预览 | 输出目录 |
|---|---|---|---|---|
| 开发 development | `npm run dev` | — | — | — |
| 调试 debug | `npm run debug` | `npm run build:debug` | `npm run preview:debug` | `dist-debug` |
| 生产 production | Nginx 托管静态文件 | `npm run build` | `npm run preview`（仅本地验收） | `dist` |

调试模式仍访问真实后端；debug 是独立的 Vite mode。调试包保留源码映射、关闭 JS/CSS 压缩，适合定位问题。生产包压缩且不生成源码映射。两个构建目录独立，互不清理。

开发端口默认 5173，预览端口默认 4173；端口占用时 Vite 会选择后续端口，以终端显示为准。可使用 `npm run debug -- --port 5174` 指定端口。

## 文件分工

```text
.env.development             开发默认值
.env.debug                   联调默认值
.env.production              生产默认值
vite.config.build.js         唯一 Vite 配置，统一管理开发、调试、构建、预览和代理
部署服务器 nginx.conf        生产反向代理（独立维护，不由 Vite 生成）
```

## 修改后端地址

默认开发和调试均连接当前联调服务器 `66.66.66.4`。个人地址写入对应环境的 `.local` 文件，该文件已被 Git 忽略。

例如开发时连接本机采集服务，但继续使用远程声纹服务，在 `.env.development.local` 中写：

```dotenv
API_PROXY_TARGET=http://127.0.0.1:5158
ACOUSTIC_PROXY_TARGET=http://66.66.66.4:18080
```

调试地址则写在 `.env.debug.local` 中。更改环境文件后重新启动对应开发/预览进程。

| 变量 | 作用 |
|---|---|
| `API_PROXY_TARGET` | Vite 的采集服务转发地址（5158） |
| `ACOUSTIC_PROXY_TARGET` | Vite 的声纹服务转发地址（18080，包含 WebSocket） |
| `VITE_API_BASE_URL` | 可选的浏览器采集服务直连基址，默认留空 |
| `VITE_NEW_API_BASE_URL` | 可选的浏览器声纹服务直连基址，默认留空 |
| `VITE_LOGIN_API_URL` | 可选的独立登录接口，默认留空 |
| `VITE_LEGACY_API_DISABLED` | 默认 true，保持未迁移旧接口停用 |

`API_PROXY_TARGET`、`ACOUSTIC_PROXY_TARGET` 只由 Vite 配置读取，不会以客户端环境变量注入页面。`VITE_*` 会进入浏览器构建，不要写密码、令牌或数据库凭据。

浏览器侧两个服务基址默认都留空，使 HTTP、音频地址和 WebSocket 使用同源入口。设置绝对基址会绕过代理，需要后端支持对应跨域访问。

Vite 变量覆盖优先级（从高到低）：启动进程的环境变量、`.env.[mode].local`、`.env.[mode]`、`.env.local`、`.env`。因此跨环境共用的 `.env.local` 可能被具体环境文件覆盖，建议使用 `.env.development.local` 等环境专用文件。

代理只读取 `API_PROXY_TARGET` / `ACOUSTIC_PROXY_TARGET`，缺省使用 `66.66.66.4:5158` / `66.66.66.4:18080`。不再从旧 `VITE_DEV_API_BASE_URL` / `VITE_DEV_NEW_API_BASE_URL` 或浏览器直连基址推断上游，避免修改一处却被另一处地址影响。旧 `.env.local` 中的 `VITE_DEV_*` 可以移除；其余变量仍遵循上述 Vite 覆盖顺序。

`0.0.0.0` 是服务监听所有网卡的地址，不能作为代理目标。当前所有服务位于局域网机器 `66.66.66.4`，开发电脑通过该机器的实际 IP 连接；代理目标须为完整 HTTP(S) 源地址，不附加 `/api`、`/auth` 等路径。

## 请求路由清单

| 浏览器入口 | 转发服务 | 转发规则 |
|---|---|---|
| `/_health-api/api/health`、`/detail`、`/table-maintenance` | 采集 5158 | 移除 `/_health-api`，仅白名单路径 |
| `/_telemetry-api/api/configuration/modules`、模块测点、实时值、历史、点位限值 | 采集 5158 | 移除 `/_telemetry-api`，仅白名单路径 |
| `/_alarm-api/api/analysis/alarms`、`status` | 采集 5158 | 移除 `/_alarm-api` |
| `/_analysis-api/api/analysis/daily-limit-trends`、`trend-insights`、`trend-alarms` | 采集 5158 | 移除 `/_analysis-api` |
| `/_runtime-api/api/runtime-info/latest` | 采集 5158 | 移除 `/_runtime-api` |
| `/_configuration-api/api/frontend-files/{文件名}` | 采集 5158 | 移除 `/_configuration-api` |
| `/auth`、`/monitor`、`/alarm`、`/collectorManagement`、`/recordings`、`/api` | 声纹 18080 | 保留完整 URI，支持 WebSocket |

采集代理会移除 Authorization 和 Cookie；声纹业务请求保留令牌，登录请求不主动携带已有令牌。未迁移旧接口仍默认禁用；即使手动启用，也使用采集专用入口，不能借用声纹 `/api` 代理。

## 生产环境使用现有 Nginx

1. 执行 `npm run build`，读取 `.env.production` 及其本地覆盖文件。
2. 将完整 `dist` 内容更新到部署服务器实际 Nginx 配置的站点根目录，路径以服务器配置为准。
3. 浏览器访问 Nginx 地址。采集服务使用 `/_telemetry-api`、`/_health-api`、`/_alarm-api`、`/_analysis-api`、`/_runtime-api` 前缀；Nginx 去掉前缀后转发至采集服务。
4. 声纹接口使用 `/auth`、`/monitor`、`/api` 等既有路径，保留完整 URI 转发至声纹服务。WebSocket 沿用现有 Upgrade 配置。

现有 Nginx 配置集中定义两个上游：

```nginx
upstream equipment_backend {
    server 127.0.0.1:5158;
    keepalive 16;
}

upstream soundvoice_backend {
    server 127.0.0.1:18080;
    keepalive 32;
}
```

这表示 Nginx 与两个后端运行在同一台服务器。若不在同机，修改对应 upstream 地址即可。保留现有采集接口白名单、PATCH 限值路由和 Authorization/Cookie 清除规则，采集请求不携带声纹登录凭据。

生产 `.env` 中的代理目标只供本地 `preview` 使用，修改它不会改变已部署 Nginx 的 upstream。生产同源部署更换后端地址只需修改 Nginx；更改 `VITE_*` 则需要重新构建前端。

生产 Nginx 配置由部署服务器独立维护。需要更新配置时，先在服务器 Nginx 安装目录执行 `nginx -t`，通过后执行 `nginx -s reload`。修改前端环境文件不会重写或重载 Nginx。

`npm run preview` 仅用于本地检查构建产物，不作为生产服务。Nginx 已开启文本 gzip，本次构建不重复生成 `.gz` 文件。静态资源使用哈希文件名，入口 HTML 沿用现有不缓存规则。

## 构建输出

构建文件将 Vue、Element Plus 和 ECharts 分成独立资源，便于缓存；业务页面的现有异步加载保持不变。大型图表依赖仍可能触发体积提示，该提示不代表构建失败。

输出包含 `.vite/manifest.json`，可检查入口及依赖关系。调试包和生产包应使用各自匹配的 preview 命令，避免预览错误目录。

## 排查 502

先运行对应环境的配置与连通性检查：

```bash
npm run check:api
npm run check:api -- --mode debug
npm run check:api -- --mode production
npm run check:api -- --offline
```

检查会列出实际 Vite 上游，提示浏览器直连覆盖，并对两个服务进行 4 秒 TCP 检查，不提交登录或修改后端数据。`--offline` 只显示配置。`connected` 只说明端口可达，不保证登录业务成功。

`[vite] http proxy error: /auth/login` 加上 `connect ETIMEDOUT 66.66.66.4:18080`，表示浏览器已进入 Vite 代理，但 Vite 到声纹服务建立 TCP 连接超时；这与浏览器 CORS 报错不同。检查开发电脑到该局域网的连接/VPN、IP 路由、防火墙及服务是否持续运行。服务监听 `0.0.0.0:18080` 时仍使用 `66.66.66.4:18080` 访问。不要通过改成 5158 或浏览器直接请求后端来绕过该问题。

1. 请求后端 `/api/health`，确认采集服务可用。
2. 开发/调试时检查对应 `.local` 文件中的 `API_PROXY_TARGET` 和 Vite 终端错误。
3. 生产时检查 Nginx error.log、upstream 地址，以及后端监听端口。
4. 健康接口恢复后，再检查模块列表、实时值和报警接口。

## 监测参数配置共享

浏览器通过 /_configuration-api/api/frontend-files/监测参数配置.json 调用 5158 的 GET/PUT 文件接口，不携带声纹 Authorization 或 Cookie，GET 禁用缓存，204 代表服务器尚无文件。Vite 开发/调试/预览由同一配置提供专用代理。

生产部署需在服务器实际 Nginx 配置中添加专用 location，剥离 /_configuration-api，允许 GET/PUT/OPTIONS，禁用代理缓存，单文件上限 5 MB，并清除 Authorization 和 Cookie。仅更新 dist 而未更新 Nginx 会导致读取或上传失败。部署环境执行 nginx -t 后再重载；前端代码修改不自动重载生产 Nginx。

首次服务器为空时自动使用内置配置，参数页点击“上传配置”后即可共享；同名文件按后端规则覆盖。导入文件不会自动上传，需点击上传配置。并发客户端的写入以服务器最后一次成功 PUT 为准。
