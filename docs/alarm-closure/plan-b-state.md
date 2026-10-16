# 计划 B：统一前端告警状态

状态：待实施。负责人：前端 B。依赖 [S0 共同契约](README.md)。

## B1：统一模型和来源适配

1. 建议新增 `src/charts/alarmModel.js`：规范化事件身份、recordType、conditionState、workflowState、severity、source、归属身份、事件/接收时间及原始字段。模型需保留 unknown，禁止以默认值补成正常。
2. 四个适配器按明确的来源字段映射；保留 rawStatus。声纹只有处理状态时不得推测恢复。缺少严重级别展示未分级，不静默假设为普通预警。
3. 模块级、测点级、未归属事件分开匹配。稳定 pointId 优先，但仍校验来源/设备；缺少身份不泛化到所有测点。声纹设备/通道映射不得凭名称猜测。
4. source + sourceEventId 去重，revision 单调更新；恢复后重发的旧响应不能复活事件。大整数身份全程字符串。
5. 共用严重程度、状态标签、活动/待办计数选择器；所有页面复用。颜色不能改变业务状态。

交付：模型模块、四来源适配器、契约夹具对应的单元测试。建议新增 `tests/alarmModel.test.mjs`，覆盖缺字段、冲突字段、ID 冲突、模块级事件、声纹无恢复能力等。

## B2：共享状态与来源健康

1. 建议新增 `src/services/alarmCenter.js` 和 `src/stores/alarmCenter.js`，对接 C 的统一契约。后端路径未定时通过可替换 transport 使用夹具，不在组件硬编码临时接口。
2. 把全局活动快照、来源健康、待办摘要与查询列表分开存放。用户修改列表筛选不能改变首页全局计数；单页组件卸载不能清空全局活动状态。
3. 登录启动、退出停止并清理、切换账户隔离；请求代次、取消、超时、轮询去重均覆盖。轮询失败保留最近事件，但将来源标为异常/陈旧。
4. 需要遍历分页/游标的快照必须收齐同一 snapshotVersion 后再发布；中途失败标 incomplete，保留旧已知活动事件，不把部分新结果当成全量。版本变化需按后端协议重新获取。
5. 计算服务端生成时间、来源 lastProcessedAt 和本地接收时间的新鲜度；HTTP 200 且处理进度停滞仍应标记来源陈旧。
6. 操作成功更新 revision 并重新获取详情/摘要；冲突不覆盖他人操作。关闭只影响处理状态，条件恢复来自来源记录。
7. B 负责在 `App.vue` 接入全局状态生命周期；C4 切换时关闭前端 DI 生成。通知仅先提供活动/待办入口，保持现有自动弹窗暂停。

## 输出给 A 的稳定接口

至少暴露 `activeEvents`、`activeTotal`、`pendingTotal`、`sourceStates`、`lastSuccessfulAt`、`eventsForMachine(id)`、`eventsForPoint(identity)`、`loadHistory(query)`、`loadDetail(key)`、`acknowledge`、`appendResolution`、`closeEvent`。

具体实现可调整命名，但 A/B 首轮必须确认一次，后续变更同步共同契约。查询结果需携带其 appliedQuery、total、complete 和更新时间。

## 并行边界与验收

B 主改新增服务/store/model、`App.vue`、`src/charts/productionLineStatus.js`、`productionLine.js` 及共用颜色规则；不同时编辑 A 的页面和 `useProductionLine.js`。既有服务只有确有复用必要时修改，并与 A 确认所有权。

建议新增 `tests/alarmCenter.test.mjs`。验收：历史查询不改变全局状态；所有启用来源完整新鲜时才可正常；来源失效不会清除已知活动事件；退出后旧请求不能污染新账户；同一活动事件确认后仍计入活动数。
