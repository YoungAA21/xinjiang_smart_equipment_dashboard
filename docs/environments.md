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
nginx.conf                   现有生产 Nginx 配置
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

代理地址选择优先级：新代理变量 → 原 `VITE_DEV_API_BASE_URL` / `VITE_DEV_NEW_API_BASE_URL` → 对应浏览器基址 → 内置联调默认值。原变量仍兼容，但环境默认文件已配置新代理变量，要覆盖地址请使用新变量。

## 生产环境使用现有 Nginx

1. 执行 `npm run build`，读取 `.env.production` 及其本地覆盖文件。
2. 将完整 `dist` 内容更新到 Nginx 站点根目录。当前 `equipment_dashboard/nginx.conf` 的根目录是 `D:/nginx/nginx-1.24.0/html/health/dist`。
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

本次沿用仓库 `equipment_dashboard/nginx.conf`，没有替换或重载服务器上的 Nginx。需要更新配置时，先在服务器 Nginx 安装目录执行 `nginx -t`，通过后执行 `nginx -s reload`。不要把另一个目录中较早的 Nginx 示例覆盖到正在使用的配置上。

`npm run preview` 仅用于本地检查构建产物，不作为生产服务。Nginx 已开启文本 gzip，本次构建不重复生成 `.gz` 文件。静态资源使用哈希文件名，入口 HTML 沿用现有不缓存规则。

## 构建输出

构建文件将 Vue、Element Plus 和 ECharts 分成独立资源，便于缓存；业务页面的现有异步加载保持不变。大型图表依赖仍可能触发体积提示，该提示不代表构建失败。

输出包含 `.vite/manifest.json`，可检查入口及依赖关系。调试包和生产包应使用各自匹配的 preview 命令，避免预览错误目录。

## 排查 502

1. 请求后端 `/api/health`，确认采集服务可用。
2. 开发/调试时检查对应 `.local` 文件中的 `API_PROXY_TARGET` 和 Vite 终端错误。
3. 生产时检查 Nginx error.log、upstream 地址，以及后端监听端口。
4. 健康接口恢复后，再检查模块列表、实时值和报警接口。

## 监测参数配置共享

浏览器通过 /_configuration-api/api/frontend-files/监测参数配置.json 调用 5158 的 GET/PUT 文件接口，不携带声纹 Authorization 或 Cookie，GET 禁用缓存，204 代表服务器尚无文件。Vite 开发/调试/预览由同一配置提供专用代理。

生产同时更新 dist 和 Nginx：项目 nginx.conf（本机上游）及上级目录 nginx.conf（远程上游）均已添加专用 location，剥离 /_configuration-api，允许 GET/PUT/OPTIONS，禁用代理缓存，单文件上限 5 MB。仅更新 dist 而未更新 Nginx 会导致读取或上传失败。部署环境执行 nginx -t 后再重载；本次代码修改不自动重载生产 Nginx。

首次服务器为空时自动使用内置配置，参数页点击“上传配置”后即可共享；同名文件按后端规则覆盖。导入文件不会自动上传，需点击上传配置。并发客户端的写入以服务器最后一次成功 PUT 为准。
