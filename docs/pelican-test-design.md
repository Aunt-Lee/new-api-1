# 模型广场「模型降智测试」功能设计文档

> 状态：已实现（2026-11-04）· 原始设计：WorkBuddy · 日期：2026-11-02
> 关联页面：模型定价页（Model Square，`web/default/src/features/pricing/`）
> 注意：本文件保留的是**初始设计方案**；最终落地与本文的差异见 §10，以 §10 为准。
> **2026-11-09 变更（当日定稿）**：测试题目最终改为「**小鳄鱼骑自行车的 SVG 循环动画**」，详见 §11。演变过程：鹈鹕骑车静态图 → 牛顿骑车 + 苹果砸头动画 → 用户当日改为小鳄鱼骑车动画；牛顿方案未提交即作废。§1–§9 中的鹈鹕描述为历史设计，不再代表当前题目。

## 1. 背景与目标

本站以「不降智不造假」为核心卖点。当前已有的证据链：24h 成功率、缓存命中率等性能指标（`perf_metrics`）。本功能新增一个**主动探测证据**：

- 定期以目标分组（**Gpt Pro**、**Gpt Plus&Team**）的真实路由链路发起一次「画鹈鹕」测试
  （prompt：*Generate an SVG of a pelican riding a bicycle*），
- 对返回 SVG 做要素/合法性打分，
- 将**原始 SVG + 分数 + 时间**公开展示给用户，作为「未降智」的可视化证据。

**成功标准**：用户在模型广场能一键查看所选分组最近一次鹈鹕测试的真实渲染结果与分数；测试全自动运行、无需人工维护；测试流量成本可忽略（单次 < ¥0.01）。

## 2. 用户体验设计

### 入口与展示

1. 定价页 Group 页签的 🛡️ 图标（现有「不降智」标签）升级为**可点击**：点击后打开「鹈鹕测试」抽屉（Drawer）。
2. 抽屉内容：
   - 顶部：分组名、取数模型、测试时间（如「12 分钟前」）、分数徽章（0–100）
   - 主体：SVG 渲染结果（sandboxed iframe，见 §7 安全）
   - 底部说明文案：「本测试通过该分组真实计费链路发起，模型需在一张 SVG 中同时画出鹈鹕、自行车并正确表达骑乘关系——这是社区通行的模型降智探测方法。」
3. 无结果时（冷启动/测试失败）：显示空态「暂无测试结果」。
4. 分数低于阈值（如 < 60）时，抽屉顶部显示黄色提示条：「最近一次测试得分偏低，可能存在质量波动」——**不自动隐藏、不粉饰**，保持公信力。

### 不做的事

- 不在列表卡片内联渲染大 SVG（页面体积与加载性能考虑），仅抽屉内展示。
- 不展示渠道明细（公开接口不暴露内部路由信息，与 §7.3 一致）。

## 3. 总体架构（两阶段交付）

```
阶段 1（MVP，人工喂结果）                阶段 2（全自动）
┌──────────┐   手动粘贴    ┌──────────┐      ┌─────────────────────────────┐
│ 管理员测试 │ ──────────→ │ admin API │      │ 定时任务（system_task 框架）  │
│ (脚本/对话)│              └────┬─────┘      │  每 6h × 2 分组              │
└──────────┘                    │ 写         │  回环调用 /v1/chat/completions│
                                ▼            └──────────────┬──────────────┘
                     ┌─────────────────────┐                │ 写
                     │ pelican_tests 表     │ ◄──────────────┘
                     └──────────┬──────────┘
                                │ 读
                     ┌──────────▼──────────┐
                     │ GET /api/pelican-test │（公开）
                     └──────────┬──────────┘
                                ▼
                     前端定价页抽屉渲染（两阶段共用）
```

- **阶段 1**：测试由管理员手动执行（本地脚本或直接对话上游），通过管理接口写入结果。后端新增约 80–100 行，1 天内可上线。
- **阶段 2**：补齐定时任务 + 回环自调用 + 自动打分，替换人工环节。后端累计约 300 行。展示层不变。
- 两阶段共用同一张表、同一个公开接口、同一套前端，阶段 1 的投入全部保留。

## 4. 数据库设计

新表 `pelican_tests`（GORM 模型 `model/pelican_test.go`，`AutoMigrate` 注册进 `model/main.go`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int, PK | GORM 自动生成 |
| `group` | varchar(64) | 分组名（唯一索引 Latest 部分索引用查询解决，见下） |
| `model_name` | varchar(128) | 取数模型，如 `gpt-6.1-sol` |
| `content` | TEXT | 原始 SVG 文本（提取代码块后，通常 5–50KB） |
| `score` | int | 0–100 |
| `status` | varchar(16) | `success` / `invalid`（模型返回非 SVG 时也留痕） |
| `fail_reason` | varchar(255) | status=invalid 时的原因（如「未包含 svg 标签」） |
| `created_at` | datetime | GORM 时间戳 |

**跨数据库兼容**（铁律）：
- `content` 用 GORM `type:text`——三库通用，禁止数据库特有 JSON 列类型。
- `group` 是保留字：查询一律走 `commonGroupCol`（`model/main.go`）。
- 「每个分组取最新一条」用 `ORDER BY created_at DESC` + 应用层去重，或窗口函数禁用（MySQL 5.7 兼容），不依赖 PG 特性。
- 历史数据：保留最近 30 条/分组，`DeletePerfMetricsBefore` 同款定时清理（可后续加）。

## 5. API 设计

### 5.1 公开读取

```
GET /api/pelican-test
→ 200 { "success": true, "data": {
    "groups": [
      { "group": "Gpt Pro", "model_name": "gpt-6.1-sol", "score": 92,
        "status": "success", "created_at": "...", "content": "<svg ...>...</svg>" },
      { "group": "Gpt Plus&Team", ... }
    ] } }
```

- 路由注册对齐 perf-metrics 范式（`router/api-router.go:36`）：
  `apiRouter.Group("/pelican-test")` + `middleware.HeaderNavModulePublicOrUserAuth("pricing")`
- 响应按分组只回**最新一条**；`content` 可选 `?with_content=0` 省略大字段（列表预取分数，点开抽屉再取内容——阶段 1 可先不做优化）。
- 加 `Cache-Control: public, max-age=600`（结果至少小时级更新，公共 CDN/浏览器可缓存）。

### 5.2 管理写入（阶段 1）

```
POST /api/pelican-test   （AdminAuth）
body: { "group": "Gpt Pro", "model_name": "gpt-6.1-sol", "content": "<svg...>", "score": 92 }
```

- 服务端**重新校验并重打分**（§6），不信任客户端分数——防误贴。
- 每分组写入即插入新行（留历史），读取侧取最新。

### 5.3 阶段 2 增量

- 手动触发：`POST /api/pelican-test/run`（AdminAuth，body 指定 group）——管理员可即时补测。
- 定时任务在 `model/system_task.go` 框架上注册（DB 租约去重 + master 独占，多实例安全）。

## 6. 测试执行与打分算法

### 6.1 执行方式（阶段 2）

回环自调用（推荐，走真实用户链路）：

```
POST http://127.0.0.1:<port>/v1/chat/completions
Headers: Authorization: Bearer <内部测试令牌>
Body: { "model": "gpt-6.1-sol",
        "messages": [{ "role": "user", "content": "Generate an SVG of a pelican riding a bicycle. Output ONLY the SVG code." }],
        "temperature": 0.7 }
```

- 内部测试令牌：启动时检查/自动创建一个系统级令牌，绑定目标分组——**每个目标分组一个令牌**（令牌的 `group` 字段决定路由池），这正好实现「以该分组身份走真实路由」。
- 备选（不推荐首选）：复用 `controller/channel-test.go` 的 `testChannel` 按渠道直测后聚合——少造令牌，但丢失分组内权重路由的真实性。
- 计费：走真实计费链路，单次成本 ≪ ¥0.01；令牌设小额额度上限防失控。

### 6.2 打分（两阶段共用，服务端实现，满分 100）

| 检查项 | 分值 | 判定 |
|---|---|---|
| SVG 代码块存在 | 20 | 响应含 \`\`\`svg 围栏或 `<svg` 标签 |
| XML 合法 | 20 | 标准 XML 解析通过（`encoding/xml` Decoder 逐 token 校验） |
| 根元素为 `<svg>` 且带 viewBox | 15 | 结构规范 |
| 要素启发式：自行车 | 15 | ≥2 个圆/ellipse（轮子）+ 直线段≥3（车架） |
| 要素启发式：骑乘 | 15 | 存在闭合曲线形体（身躯）且与轮子空间关系合理（形体中心高于轮轴） |
| 复杂度 | 15 | path 元素数 ≥5 且总长度 ≥2KB |

- 任何一项 0 分且属硬性项（前 3 项）→ `status=invalid`，存 `fail_reason`。
- 阈值语义：≥80 优秀，60–79 正常波动，<60 提示条。阈值可在阶段 2 用历史分布校准。

## 7. 安全设计

1. **SVG 渲染必须沙箱化**：上游 LLM 输出不可信。前端用 `<iframe sandbox srcDoc>` 渲染（无 `allow-scripts`），禁 JS 执行；严禁 `dangerouslySetInnerHTML` 直接注入页面 DOM。
2. **公开接口无敏感信息**：不回传渠道名/密钥/内部路由；`group`/`model_name` 本就是公开信息。
3. **打分在服务端重算**：管理写入不可注入伪造高分（分数由内容推导）。
4. **写入限频**：AdminAuth 天然限管理员；阶段 2 的 run 接口加每分钟 1 次限频。
5. **响应体大小**：`content` 上限 200KB，超出截断并标 invalid。

## 8. 实施计划

| 阶段 | 内容 | 涉及文件 | 工作量 |
|---|---|---|---|
| 1a | 表 + 模型 + AutoMigrate | `model/pelican_test.go`、`model/main.go` | 0.5d |
| 1b | 管理写入 + 公开读取接口 + 服务端打分 | `controller/pelican_test.go`、`router/api-router.go` | 0.5d |
| 1c | 前端抽屉 + 🛡️ 图标联动 + sandbox 渲染 | `web/default/src/features/pricing/`（新组件） | 1d |
| 2a | 回环自调用 + 内部令牌管理 | `service/pelican_test.go`（新） | 1d |
| 2b | 定时任务注册 + 手动触发接口 | `service/`、`controller/pelican_test.go` | 0.5d |
| 2c | 历史清理 + 阈值校准 | `service/` | 0.5d |

阶段 1 合计约 2 天（一名熟悉本仓库的工程师）；阶段 2 再加 2 天。

## 9. 风险与权衡

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| 上游返回非 SVG（拒答/闲聊） | 中 | 展示空结果 | `status=invalid` 留痕，前端空态；prompt 加「Output ONLY the SVG code」 |
| SVG 含恶意构造 | 低 | XSS | 强制 sandbox iframe，无脚本执行（§7.1） |
| 模型输出风格差异导致打分误判 | 中 | 分数失真 | 启发式只查「要素存在性+结构」，不评美学；阈值留波动区间 |
| 测试令牌泄露 | 低 | 被刷额度 | 系统级令牌不外发，仅回环调用使用；小额上限 |
| 公开接口被刷 | 低 | 带宽 | Cache-Control + 内容上限 200KB |
| 被质疑「测试也可能被换模绕过」 | 中 | 公信力 | 文案明示「真实计费链路 + 定时采样」；分数与原始 SVG 全公开，不粉饰 |

**已否决的备选方案**：
- ❌ 前端直接调用上游测试：需在前端暴露令牌/密钥，安全问题，直接排除。
- ❌ 复用 `/api/status` 携带 SVG：status 全站高频请求，塞 50KB 内容不可接受。
- ❌ 阶段 2 用 `testChannel` 按渠道聚合作为首选：实现更省但丢失「分组权重路由」真实性，测试证据的说服力打折——仅作回环调用故障时的降级路径。

## 10. 最终实现与本文的差异（2026-11-04 落地）

| 项目 | 本文设计 | 实际实现 |
|---|---|---|
| 调度周期 | 每 6h × 2 分组 | **随机 12–18h**（2026-11-05 由 18–24h 调整），硬性下限 12h；下次时间由「上次成功时间戳」哈希推导，稳定且重启无法绕过下限 |
| 调度框架 | `system_task` 框架 | 独立的 master-only 后台循环（每 15min 检查一次）。框架的固定 `Interval()` 无法表达随机窗口；用 `common.IsMasterNode` + 进程内 CAS 保证单点执行 |
| 打分 | 100 分启发式评分 + 低分提示 | **不做打分**，直接展示未经修改的原始 SVG + 测试时间，避免启发式误判反而损害公信力 |
| 展示位置 | 🛡️ 图标点击打开 Drawer | 定价页**模型模块下方新增独立「模型降智测试」模块**，两张分组卡片并排内联展示 |
| SVG 渲染 | `iframe sandbox srcDoc` | `<img src="data:image/svg+xml,...">`：SVG 处于惰性图片上下文，脚本天然不执行；后端另过滤 `<script>` / `<foreignObject>` |
| 测试分组 | Gpt Pro / Gpt Plus&Team | 同左，每组各一次 |
| 阶段划分 | 阶段 1 人工喂结果 → 阶段 2 全自动 | **一次性直接交付全自动**，无人工写入接口；额外提供 `POST /api/pelican-test/run`（AdminAuth）供管理员即时补测 |

**实际新增/修改文件**

- 后端：`model/pelican_probe.go`（表 + CRUD）、`model/main.go`（AutoMigrate 两处）、`service/pelican_probe.go`（调度 + 回环调用 + 系统令牌 + SVG 提取）、`controller/pelican.go`（公开读 + 管理员手动触发）、`router/api-router.go`（路由）、`main.go`（启动装配）
- 前端：`features/pricing/api.ts`、`features/pricing/components/pelican-test-section.tsx`、`features/pricing/components/index.ts`、`features/pricing/index.tsx`
- i18n：`en.json` / `zh.json`（其余语言 fallback 到 en）

**运行要点**

- 目标模型 `gpt-6.1-sol`；每个分组自动创建/复用一条 `system-pelican-probe:<group>` 内部令牌（`UnlimitedQuota`，永不过期），由 `TokenAuth → Distribute → Relay` 真实链路选取该分组渠道。
- 冷启动（表中无成功记录）会在服务启动约 1 分钟后立即测一次；全部分组失败时 1 小时后重试，不计入调度锚点。
- 历史数据保留 30 天；`GET /api/pelican-test` 带 `Cache-Control: public, max-age=300`，且只回公开的分组/模型/状态/时间/SVG，不回内部 `fail_reason`。
- 管理员手动触发会写入新的成功记录，从而重置下一次自动运行时间（绕过「两次至少 12h」的是人工操作，不是自动调度）。
- 2026-11-05 调整：卡片底部不再显示「x 小时前」这类相对时间，仅保留每张结果图下方的 `MM-DD HH:mm` 绝对时间与悬停精确时间；调度窗口同步收窄为 12–18h。

## 11. 当前测试题目：小鳄鱼骑车动画（2026-11-09 定稿）

**变更经过**：原始题目「鹈鹕骑自行车（静态 SVG）」→ 同日改为「牛顿骑车 + 苹果砸头动画」→ 用户当日再次改为「**小鳄鱼骑自行车的循环动画**」。牛顿方案未提交即作废，本节是**当前唯一有效题目**；§1–§9 的鹈鹕描述仅为历史设计。改题目的动机不变：静态构图题只能检验一次成图，带时间维度的动画能更明显地暴露模型能力退化。

| 项目 | 最终内容 |
|---|---|
| 题目 | 一只可爱的绿色小鳄鱼骑着自行车的**循环动画**（无牛顿、无苹果砸头） |
| Prompt 关键要求 | 长吻、可见眼睛、背脊三角鳞甲、会摆动的尾巴、蹬踏的小腿；自行车两个圆轮 + 辐条 + 车架。必须用 SMIL `<animate>` / `<animateTransform>` 且 `repeatCount="indefinite"`：车轮旋转（辐条可见）、车身轻微起伏/平移、双腿交替蹬踏、尾巴来回摆动；自包含、无脚本/外链/`<foreignObject>`、只输出 SVG |
| 页面说明文案 | EN key：`At a random time, we ask each group to draw an animated SVG of a little crocodile riding a bicycle. The untouched model output is shown here.` / 中文：「系统在随机时间请求各分组绘制「小鳄鱼骑自行车」的 SVG 动画，这里展示未经修改的模型原始输出。」 |
| 图片 alt | `A little crocodile riding a bicycle` / 「小鳄鱼骑自行车」 |
| 后端注释 | `main.go`、`model/pelican_probe.go`、`service/pelican_probe.go`、`features/pricing/api.ts` 均已同步，不再出现牛顿 / 苹果描述 |

**动画渲染可行性（已实测）**：前端仍用 `<img src="data:image/svg+xml,...">` 惰性图片上下文。用真实 Chrome 156 加载含 `<animateTransform>` / `<animate>` 的示例 SVG，间隔 600ms 连截三帧，三帧字节互不相同 → 声明式 SMIL 动画在 `<img>` 中正常播放，无需改为 iframe / inline SVG，也不牺牲「脚本不执行」的安全边界。因此**不改渲染方式**，只在前端注释与 Prompt 中固化这一约束。

**动画门禁（同日补充）**：仅靠 Prompt 并不足以保证「动画」落地——原 `extractPelicanSVG()` 只校验 `<svg>` 存在、大小 ≤ 200KB、无 `<script>` / `<foreignObject>`，模型若返回静态 SVG 仍会被记为 `success` 并公开展示，等于把「没遵循指令」伪装成通过。故在安全过滤之后追加一条校验：SVG 必须包含 `<animate` 前缀（覆盖 `<animate>` / `<animateTransform>` / `<animateMotion>`），否则记为 `invalid` 并写入 `fail_reason = "svg is not animated"`。静态图会如实暴露为一次失败探测，而非被当作「未降智」证据。此校验只作用于新结果，不改写历史行，与具体题目无关。回归测试见 `service/pelican_probe_animation_test.go`（7 个子用例：SMIL 两种标签与大小写混写放行；静态图 / script / foreignObject / 无 svg 拒绝）。

**保持不动的部分**：内部标识符（`pelicanProbe*` 符号、`pelican_tests` 表、`/api/pelican-test` 路由、组件文件名、系统令牌前缀）全部保留，避免为了改题目引入数据库迁移与路由断裂；用户可见文案已不含「鹈鹕 / 牛顿 / 苹果」。调度窗口 12–18h、每组历史 4 次、保留 30 天、不做打分均不变。

**历史数据**：`pelican_tests` 中已有的旧题目结果不会被改写，会随 30 天保留期或后续探测（每组保留最近 4 次）自然淘汰。如需立即替换，可在发布后用 `POST /api/pelican-test/run`（AdminAuth）手动触发一次；是否清空历史数据需单独确认，本次未做。

**验收（真实浏览器，2026-11-09）**：在隔离 Docker 实例（`http://127.0.0.1:3018`，theme=default）注入 8 条小鳄鱼动画 fixture 到 `pelican_tests`，用本机 Chrome 156 打开 `/pricing`，`.local-test/croc_pricing_probe.mjs` 得 **15 PASS / 0 FAIL**，浏览器 console / pageerror / requestfailed 全为 NONE：

- 英文原文与中文翻译两套说明文案、两套 alt 均正确，页面不再出现「鹈鹕 / 牛顿 / 苹果」字样；
- 两个分组各渲染 4 张图（共 8 张），全部走 `data:image/svg+xml` 惰性图片且含 SMIL `<animate>`、不含脚本；
- 对定价页内真实 `<img>` 连截三帧（间隔 650ms），像素字节互不相同；另外连录 18 帧合成 `.local-test/croc-live.gif`，18 帧哈希全不相同 → **动画在真实页面里确实播放**；
- 中文验收需预置 `localStorage.i18nextLng = 'zhCN'`：`i18n/config.ts` 的 `detection.order` 只有 `localStorage`，浏览器 `Accept-Language` 不生效。

截图：`.local-test/croc-shots/01-pricing-en.png`、`02-pricing-zh.png`、`frame-a/b/c.png`；实时预览 `.local-test/croc-live.html`。注意隔离库未配置任何模型/渠道，页面显示「本站当前已启用模型，总计 0 个」属预期；**真实模型能否按 prompt 稳定产出合规动画 SVG，仍需在有上游渠道的环境等 12–18h 调度窗口或管理员手动触发 `POST /api/pelican-test/run` 验证**，本次未覆盖。
