# 工单系统项目交付方案 · NewtonRouter / New API

> **版本**：契约 v3.1（**终稿**）＋ 前端实测事实补录 r1 ＋ **参数拍板 r2**（含 qa Delta R1、backend 最终口径、data 层技术更正并入）
> **日期**：2026-11-06
> **状态**：设计定稿 + §14.1 共 13 项已全部拍板，**待开工**（尚未写实现代码）
> **本轮范围**：仅交付方案与验收口径；**未修改任何既有仓库源码，仅新增本设计文档；未提交、未部署**
> **唯一基线**：本文附录 A。历史所有 v1.1 / v1.2 / v2.0 / v3.0 分册及 Delta 中的冲突条目一律作废，以本文为准。**本文只用章节号交叉引用，不使用行号**（行号会随修订漂移）。
> **r1 收口说明**：附录 A 的 12 条冻结契约**一字未改**。r1 仅补录 frontend-engineer 最终分册中 **6 条经主理人逐条复核的仓库实测事实**（§1.1 第 3 条 ＋ 新增 §1.3 的 5 条），及其在 §8 / §10.1 / §14.1 派生的实现约束与验收项。这 6 条属**事实层 / 实现约束层**，不产生新契约、不改变任何冻结口径；该分册基于 Phase 1 旧模型的契约层内容仍全部作废。
> **r2 拍板说明**：用户已就 §14.1 的 13 项全部拍板，该节表格改为**实现唯一依据**。其中 4 项由用户直接选定：限频 **5 次/60s**（严于建议值 10 次）、生产拓扑 **单实例 master**、命令面板既有泄露**不修只门控新增项**、生产库型**不预设、三库全测**；其余 9 项按建议默认值执行。**附录 A 第 11 条仅把原已明确标注「待用户拍板、非冻结定值」的限频数值填为 5/60s，属填空，不是修改冻结契约**。

---

## 0. 文档说明

### 0.1 需求来源

> 在后台的个人菜单下，新增一个工单系统，用户可以提工单给管理员，管理员可以进行回复

经 `AskUserQuestion` 确认的四项决策：

| 决策项 | 用户选择 |
| --- | --- |
| 本轮交付物 | **先出交付方案**，本轮不写代码 |
| MVP 额外能力 | **状态流转**（四态） |
| 管理员端形态 | **Admin 分组新增管理页** |
| 通知机制 | **站内未读角标 + 轮询** |

### 0.2 交付物清单

| # | 交付物 | 位置 |
| --- | --- | --- |
| 1 | 项目交付方案（本文） | `docs/ticket-system-delivery-plan.md` |
| 2 | v3.1 冻结契约全文 | 附录 A |
| 3 | 分册来源与作废记录 | 附录 B |
| 4 | 产品 / 架构 / 后端 / 数据 / 前端 / 部署 / 测试各专家分册 | 团队内部归档，按附录 B 处置 |

### 0.3 明确不做（本期）

附件上传、优先级/分类字段、管理员内部备注、邮件通知、WebSocket / SSE 实时推送、按管理员独立未读水位、工单删除接口、历史消息分页、内容敏感信息服务端检测/打码、字段级加密、用户注销后工单匿名化或清理、`authz.RequirePermission` 接入、Turnstile 接入、任何调度器或 TTL 清理任务。

---

## 1. 现状调研结论

### 1.1 前端菜单与路由

- 「个人菜单」= `web/default/src/hooks/use-sidebar-data.ts` 的 `Personal` 分组；管理员入口在 `Admin` 分组。
- 项目**没有任何 ticket / 工单表或接口**，属全新功能域。
- **`Ticket` 是 `lucide-react` 图标标识符，已绑定给兑换码**（`use-sidebar-data.ts:32` import、`:138-141` 用于 `/redemption-codes`）。实测全仓 8 个 locale 中 `"Ticket"` key **0 命中**、`t('Ticket')` **0 处调用** —— 所以「不能用 `Ticket`」的准确理由**不是 i18n key 撞车**，而是：① 同一文件里图标 `Ticket` 与文案 `Ticket` 语义打架；② `command-menu.tsx:75` 用 `navItem.title` 做模糊搜索，裸词会让「工单」与「兑换码/票券」意图混淆；③ `nav-group.tsx:74` 用 `item.title` 拼 React key，通用词提高碰撞概率。工单入口改用 `LifeBuoy` + 带前缀的专属文案 key。
- 技术栈：Go + Gin 1.9.1 / GORM 1.25.2 后端；React 19 + Rsbuild + Bun 前端；SQLite / MySQL ≥5.7.8 / PostgreSQL ≥9.6 三库兼容。
- 前端 `dist` 经 `//go:embed web/default/dist` 编进单一 Go 二进制，**前后端必须整体重建并重启**，不能只替换静态文件。

### 1.2 仓库事实基线（各分册现场核实，实现时逐条遵守）

| 事实 | 位置 | 对实现的影响 |
| --- | --- | --- |
| 响应信封统一 `HTTP 200 + {success,message,data}`；`ApiErrorI18n` 内部写死 `{success,message}`，**无 code 字段** | `common/gin.go:199-239` | 业务失败沿用 200；机器码需 controller 镜像信封追加 `code` |
| 鉴权 `UserAuth` / `AdminAuth`（role ≥ 10）；会话缺失或 `New-Api-User` 头不匹配 → 401；权限不足 → **200 + success:false（无 code）** | `middleware/auth.go:44-53,97-139,181-193` | 越权业务码与鉴权 401 必须区分验收 |
| `minRole ≥ 10` 自动触发 `beginAdminAudit`；只对写方法生效，缓冲上限 64 KiB | `middleware/audit.go:106-118,157-163` | 管理端 A4/A5/A6 天然留痕；`action="generic"` |
| 分页 `GetPageQuery` 默认 10、硬上限 100，**只用于 U2/A1 列表**，U4 不调用 | `common/page_info.go:41-82` | 详情流本期不分页 |
| 限频 `userRateLimitFactory` 按 `c.GetInt("id")`；id=0 → 401；超限 `c.Status(429)` **无 body**；窗口为**滑动日志** | `middleware/rate-limit.go:119-196`、`common/rate-limit.go:45-70` | 用户级限频必须挂在鉴权之后；429 按 HTTP 码判定 |
| 限频默认值 `GLOBAL_API_RATE_LIMIT=360/180s`、`CRITICAL_RATE_LIMIT=20/20min`、`SEARCH_RATE_LIMIT=10/60s` | `common/init.go:120-133` | 新增限频函数 duration 不得超过 `RateLimitKeyExpirationDuration=20min`（`common/constants.go:220-221,247`），否则 key 提前过期导致绕过 |
| 新表双注册 `migrateDB()` 与 `migrateDBFast()`；`InitDB()` 在 `!IsMasterNode` 时直接 `return nil` | `model/main.go:207-215,263-391` | 滚动更新必须 master 优先 |
| **`migrateDBFast()` 全仓库无任何调用点**（仅 `model/main.go:319` 定义） | Grep 全仓 | 第二处注册是对称/未来预留，当前为 dead code；**slave 不自建表** |
| `IsMasterNode = NODE_TYPE != "slave"`；未设置/拼错一律 master | `common/init.go:87` | 生产多实例必须给所有 worker 显式设 `NODE_TYPE=slave` |
| 主库 `DB` 与日志库 `LOG_DB` 分离；`LOG_DB` 可能是 ClickHouse 且带 TTL | `model/main.go:53-55,223-249,393-457` | **工单表绝不能进 LOG_DB**；备份走主库方案，不依赖 LOG_DB |
| DB 连接池 `SQL_MAX_OPEN_CONNS=1000` / `SQL_MAX_IDLE_CONNS=100` / `SQL_MAX_LIFETIME=60` | `model/main.go:203-205` | 压测按此配置，不自行假设 |
| `lockForUpdate` 在 SQLite 下直接返回、不加锁 | `model/locking.go:20-25` | 并发靠「条件 UPDATE + `RowsAffected` 闸门」，不靠 `FOR UPDATE` |
| LIKE 转义统一 `LIKE ? ESCAPE '!'`，不用 `\` | `model/token.go:88-107`、`model/log.go:33-47` | 三库反斜杠字面量差异规避 |
| GORM 1.25.2 对 `CreatedAt`/`UpdatedAt` 且 int/int64 自动 `AutoCreateTime`/`AutoUpdateTime=UnixSecond`，`Updates(map)` 会隐式 bump | `gorm/schema/field.go:294` | 必须 `autoCreateTime:false` / `autoUpdateTime:false`；备选方案 B = 字段改名 `CreatedTime`/`UpdatedTime` + `column:` 映射（`model/token.go:20-21`、`model/channel.go:32` 有范式），**二选一不混用** |
| `type:text` 列**不能带 `default:''`**：MySQL 8.0.13 前 TEXT/BLOB 不允许 DEFAULT | `model/pelican_probe.go:16`、`model/token.go:26` 均为裸 `gorm:"type:text"` | `content` tag 保持最简，event 行由 service 显式赋 `''`（非 NULL） |
| 用户软删 `DeletedAt`；`Delete()` / `HardDelete()` 都不级联业务表；`GetAllUsers` 用 `tx.Unscoped()` | `model/user.go:48,302-309,414-432,741-763` | 用户注销后工单保留成立；**A1 用户名批量回填必须 `Unscoped()`**，否则已注销用户名为空 |
| **HTTP 访问日志不记 body / header / `c.Errors` / `c.Keys`，但会记 query string** | `middleware/logger.go:19-40`、`gin/logger.go:236-265` | formatter 只取 8 个元数据字段；但 `gin` 把 `URL.RawQuery` 拼进 `param.Path` 并打印 → **A1 的 `keyword` 明文进 `[GIN]` 日志**，见 §9 |
| `BodyStorageCleanup()` / `CleanupFileSources()` 零日志语句 | `middleware/body_cleanup.go:11-22`、`common/gin.go:99-106`、`service/file_service.go:144-154` | 无需为工单路由做日志排除 |
| `VERSION` 为 **0 字节空文件**，`X-New-Api-Version` 响应头为空 | `VERSION` | **不能用作版本判断**，只能靠 digest / commit sha |
| `middleware/cache.go:12` 对除精确 `/` 外所有路径给 `max-age=604800`；`web-router.go:40` 的 no-cache 只覆盖 SPA fallback；`web-router.go:36` 显式排除 `/assets` 前缀 | 源站 | **「容器已最新但页面仍旧版」的源站根因**，非仅 Cloudflare；发布/回滚后均需 Purge |
| `FRONTEND_BASE_URL` 在非 master 实例把前端请求 301 走 | `router/main.go:20-33` | 直连源站比对前必须确认该变量为空，否则拿到 301 而非 HTML |
| 后端不新增 i18n YAML 键；CI 不调用 `i18n:sync`，`scripts/sync-i18n.mjs` 无失败退出 | 构建链 | 前端只改 `en.json` + `zh.json` 不破坏构建 |
| **`.github/workflows/` 6 个文件均无 `services:` DB 容器、无 `go test` / `bun test` / Playwright 步骤**；`pr-check.yml` 只有 `peakoss/anti-slop@v0.2.1`；仓库 `docker-compose.yml` 仅 `postgres:15` + 注释掉的 `mysql:8.2` | devops / qa 实读 | **三库 × Redis 六组合必须在 CI 之外（本地/预发）搭建**，不能假设 CI 会跑兼容矩阵 |

### 1.3 前端实测事实（r1 补录，实现时逐条遵守）

> 以下 5 条由主理人逐条 Grep / Read 复核、位置均为实际文件行号；连同 §1.1 第 3 条（`Ticket` 图标 / key 歧义）合计 6 条。它们是**仓库现状事实**，不是新契约，但任一被忽略都会在实现期产生可见 bug。

| # | 实测事实 | 位置 | 对实现的硬性约束 |
| --- | --- | --- | --- |
| F2 | `i18n` 只关了 `nsSeparator`，**`keySeparator` 仍是默认 `'.'`** | `i18n/config.ts:52` | 后端错误码 `ticket.title_empty` 等含点号，**绝不能直接传给 `t()`**（会被当作嵌套路径解析并回显原始 key）。须建 `code → 无点号英文短语 key` 映射，例如 `ticket.title_empty → "Ticket title cannot be empty."`；用户可见错误优先展示后端 `message`，映射表仅作兜底 |
| F3 | `"Pending"` 在 **8 个 locale 中均已被占用**，`zh.json` 为「待确认」、`zh-TW.json` 为「待確認」 | `i18n/locales/*.json` 约 `:3311` | 工单四状态文案 key **必须带前缀**（`'Ticket Pending'` / `'Ticket Processing'` / `'Ticket Resolved'` / `'Ticket Closed'`），否则状态标签串成「待确认」。§8.5 key 清单按此执行 |
| F4 | 全局 `QueryClient` 设 `refetchOnWindowFocus:false`、`staleTime:10s`；`queryCache.onError` 对 HTTP 500 会 `router.navigate({to:'/500'})` | `main.tsx:70`、`:85-99` | 未读轮询**必须在 hook 内显式覆盖**轮询与可见性参数，不能依赖全局默认；轮询 `queryFn` **必须捕获 `AxiosError` 并返回上一次成功值 / 安全默认值，绝不向上抛**，否则一次后端 5xx 会把整站导航到 `/500`。§6.2 的失败退避与「保持上次角标」以此为前提才成立 |
| F5 | `command-menu.tsx` 直接 `useSidebarData()`，**未走** `use-sidebar-view.ts` 的角色过滤；`app-sidebar.tsx` 才用 `useSidebarView()`；命令项 `value={navItem.title}` 用于模糊搜索；`nav-group.tsx` 用 `item.title` 拼 React key | `command-menu.tsx:36,47,51,75`；`app-sidebar.tsx:48`；`nav-group.tsx:74` | 新增的 Admin 项 `/ticket-management` 会出现在**普通用户**命令面板搜索结果中（路由 `beforeLoad` 兜底 `/403`，但入口已泄露）。实现时对**新增的工单两个入口**做角色门控；**是否顺带修复既有 Admin 项泄露属既有行为变更，列 §14.1 #13 待确认，不擅自扩大改动面**。同时印证 §1.1：裸词 `Ticket` 会与兑换码意图混淆 |
| F6 | `isModuleEnabled()` 对**未映射 URL 直接 `return true`（默认可见）**，注释明写 `e.g. system settings and new features` | `hooks/use-sidebar-config.ts:97,173-177` | **不要**为 `/tickets` / `/ticket-management` 往 `URL_TO_CONFIG_MAP` 新增映射（新增反而使其变成「可被管理员/用户配置隐藏」，扩大改动面且需补配置 UI）；详情页用 `?id=` search param 页内面板实现，**不新增第三条路由**，与 §3.2 仅两个路由文件一致 |

---

## 2. 需求与范围

### 2.1 角色与核心用例

| 角色 | 用例 |
| --- | --- |
| 普通用户 | 提交工单、查看自己的工单列表、查看对话流、追问、关闭、重开、重开并继续回复、看未读角标 |
| 管理员 | 查看全部工单、按状态筛选、搜索（标题 / 工单 ID / 提交人用户名）、查看对话流、回复、显式改状态、看全局未读角标 |

### 2.2 MVP 功能清单

1. 工单提交与对话流（正文纯文本）。
2. 四态状态流转：`pending` / `processing` / `resolved` / `closed`，每次**真实状态变更**生成独立系统事件行。
3. 站内未读角标：按**有新动态的工单数**计，30s 轮询。
4. 管理端列表 + 筛选 + 搜索 + 回复 + 改状态。
5. 中英文 i18n，其余语言 fallback 英文。

### 2.3 全局设计原则

- **DB 水位是未读的唯一真源**，Redis 完全不参与未读（只用于限频）。
- **无自动状态联动**：状态只能由显式动作改变，回复动作本身不改状态、不写 event。
- **无调度器、无 TTL 清理**：`main.go` 不改。
- **写操作单库事务 + CAS 条件 UPDATE**，不引入分布式锁、跨库事务。
- **越权与不存在完全同构**：统一 `ticket.not_found`，防枚举。

---

## 3. 总体架构

### 3.1 分层与依赖方向（单向，禁循环）

```
router/api-router.go
    -> controller/ticket.go          (HTTP 边界：绑定、取 id/role、错误映射)
        -> service/ticket.go         (唯一事务编排层：归属、状态机、事件、水位、去重、DTO)
            -> model/ticket.go
            -> model/ticket_message.go
                -> model.DB  -> SQLite / MySQL / PostgreSQL
```

- `controller` **不得** import `model`、不得访问 `model.DB`、不得 import `gorm`；禁止把请求体绑到 model 结构体。
- `viewerID = c.GetInt("id")`、`viewerRole = c.GetInt("role")` 由鉴权中间件注入，以函数参数传入 service，**绝不从请求体取**。
- 两个 model 文件只有结构体 / 枚举 / `TableName()` / GORM tag，无业务逻辑。

### 3.2 文件清单

| 文件 | 类型 | 职责 |
| --- | --- | --- |
| `model/ticket.go` | 新增 | `Ticket` 结构体、tag、索引、枚举常量 |
| `model/ticket_message.go` | 新增 | `TicketMessage` 结构体、tag、索引、枚举常量（**不是 `ticket_reply.go`**） |
| `service/ticket.go` | 新增 | 事务编排、状态机、事件生成、水位维护、去重、LIKE 转义、批量用户名回填、DTO |
| `controller/ticket.go` | 新增 | 参数绑定、长度校验入口、错误码映射 |
| `model/main.go` | 修改 | `migrateDB()` 与 `migrateDBFast()` **双注册**两张表 |
| `middleware/rate-limit.go` | 修改 | 新增 `TicketWriteRateLimit()`，复用 `userRateLimitFactory`，mark 前缀 `"TW"` |
| `router/api-router.go` | 修改 | 挂载 `/ticket` 与 `/ticket/admin` 共 13 条路由 |
| `web/default/src/features/tickets/` | 新增 | 用户端工单页面与组件 |
| `web/default/src/features/ticket-management/` | 新增 | 管理端页面与组件 |
| `web/default/src/hooks/use-sidebar-data.ts` | 修改 | Personal / Admin 两个分组加入口与角标 |
| `web/default/src/routes/_authenticated/tickets/index.tsx` | 新增 | 用户端路由 |
| `web/default/src/routes/_authenticated/ticket-management/index.tsx` | 新增 | 管理端路由 |
| `web/default/src/i18n/locales/en.json` / `zh.json` | 修改 | 新增 key |
| `main.go` / `common/gin.go` / `common/json.go` / `i18n/*` / `middleware/auth.go` / `middleware/audit.go` / `middleware/logger.go` | **不改** | 冻结清单外 |

新增 Go 文件均为普通 `.go`，**不得以 `_test.go` 结尾**（会被排除）；回归用例以联调清单 + 非 Go 脚本交付。

### 3.3 三库 / SQL 硬约束

- 全部走 GORM 方法；**零 raw SQL / `DB.Exec` / `ALTER COLUMN` / 窗口函数 / `GREATEST` / `IFNULL` / 专有 JSON 列 / 布尔列 / `default:true` tag / 外键 / CHECK**。
- **零 default tag**：所有业务默认值由 service 显式赋值。既满足契约，也规避 MySQL TEXT 不允许 DEFAULT 与 `AGENTS.md:90` 所述「布尔 default 导致 AutoMigrate 反复 ALTER」。`content` 的 tag 保持裸 `gorm:"type:text"`。
- 列间比较用 `Where("col > ?", gorm.Expr("other_col"))`；原子自增用 `gorm.Expr("message_count + ?", n)`；标记已读用「列到列赋值」`SET col = last_message_id`，不传应用侧预读值（防 TOCTOU）。
- 时间统一 `int64` Unix 秒，由 `common.GetTimestamp()` 显式赋值；配合 `autoCreateTime:false` / `autoUpdateTime:false`。
- 新表不含 `group` / `key` 等保留字列，无需 `commonGroupCol`。
- 排序：详情流取最近 200 条后按 `created_at ASC, id ASC` 正序返回；列表 `last_message_at DESC, id DESC`；秒级并列由 `id` 兜底。
- **本期工单业务代码无 JSON 编解码点**（事件改结构化列），新增 4 个 Go 文件 `encoding/json` 零出现。
- 水位/notify 列与 `ticket_messages.id` **使用同一 Go 类型 `int` 与同一物理列类型**，避免比较时隐式转换。

---

## 4. 数据模型（v3.1 冻结）

### 4.1 `tickets`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int, PK | GORM 自增 |
| `user_id` | int | 归属用户，逻辑引用，**无外键** |
| `title` | varchar(200) | 1–200 rune |
| `status` | varchar(16) | `pending/processing/resolved/closed` |
| `message_count` | int | 流条目总数，**含 event 行**；恒等于 `COUNT(ticket_messages WHERE ticket_id=?)` |
| `last_message_id` | int | 最后一条流条目的 id（含 event），单调不减 |
| `last_message_at` | bigint | 最后动态 Unix 秒；列表排序键 |
| `last_user_notify_id` | bigint | 最近一条 `notify_target='user'` 的流条目 id |
| `last_admin_notify_id` | bigint | 最近一条 `notify_target='admin'` 的流条目 id |
| `user_last_read_id` | bigint | 用户侧已读水位，**本行（本工单）一份** |
| `admin_last_read_id` | bigint | 管理员侧已读水位，**同样是 `tickets` 行级字段、按工单存**；所有管理员共享本工单这一份，非每人一份 |
| `created_at` / `updated_at` | bigint | Unix 秒；`autoUpdateTime:false`，service 显式赋值；`updated_at` 仅作审计，不参与列表排序 |

> **易错点（qa Delta R1 修正）**：四个水位列**全部是 `tickets` 的行级字段，每个工单一行**，不是系统级全局单值、也不按管理员分表。`U7/A6` 带 `:id`，是**按工单**标记已读。详见 §6.1。

### 4.2 `ticket_messages`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int, PK | 全局单调自增，水位与定序的唯一刻度；**message 与 event 共用单一序列** |
| `ticket_id` | int | 逻辑引用，无外键 |
| `kind` | varchar(16) | `message` \| `event`（`kind='event'` 即系统事件，无需另设身份） |
| `actor_role` | varchar(16) | `user` \| `admin`，**存实际触发方**；`system` 作为保留枚举值本期**不写入** |
| `author_user_id` | int | 触发者 id（event 行也存，用于溯源） |
| `author_username` | varchar(64) | 发帖时用户名快照（源 `Username` max=20）；用户侧不暴露管理员账号 |
| `content` | text | 正文；tag 为裸 `gorm:"type:text"`，**`kind='event'` 时恒为空串 `""`**（非 NULL、非 JSON、非译文） |
| `event_type` | varchar(32) | MVP 仅 `status_changed`；message 行为 `""` |
| `from_status` / `to_status` | varchar(16) | 结构化列，**不存 JSON、不存译文**；message 行为 `""` |
| `notify_target` | varchar(16) | `user` \| `admin` \| `none` |
| `created_at` | bigint | Unix 秒；append-only，无 `updated_at` / `deleted_at` |

### 4.3 索引（严格 3 个，不自行增加）

| 索引 | 列 | 服务 |
| --- | --- | --- |
| `idx_message_ticket` | `(ticket_id, id)` | 详情流 `DESC LIMIT 200`、COUNT 对账、未来游标 |
| `idx_ticket_user_status` | `(user_id, status, last_message_at)` | 用户列表带状态筛选、用户未读前缀 |
| `idx_ticket_status_activity` | `(status, last_message_at)` | 管理员列表与筛选 |

不建索引：`title` / `content`（长文本，规避 MySQL 前缀上限与三库差异）、水位列（row-wise 比较建索引无效）。

> **技术更正（data 层深化，采纳）**：原提法「后续评估 `idx_ticket_admin_notify`」**作废**。A2 的 `WHERE last_admin_notify_id > admin_last_read_id` 是**同一行内两列相比**，比较对象不是常量，单列 B-tree 无法做范围裁剪，加该索引无效。真正能走索引的方向只有：① 加冗余标志列 `admin_has_unread int`（非 bool）+ 索引，由写事务与标记已读同步维护（**代价：引入第二真源，与「DB 水位唯一真源」有张力，须强事务 + 用 `last_admin_notify_id > admin_last_read_id` 离线对账**）；② 接受扫表。PG 部分索引 / 表达式索引因三库不一致禁用。**本期选 ②**，只作为未来演进方向记录。
>
> **索引 3 vs 4 裁决（采纳 3 个）**：U2 的 `status?` 是可选参数，**不带 status 是常态**，此时 `idx_ticket_user_status` 中间列断开、`last_message_at` 无法用于有序扫描 → 会有 filesort。裁决为**本期接受**：纯新增表、单用户工单数有界、避免多一个索引带来写放大；若压测不达标，补 `idx_ticket_user_activity(user_id, last_message_at)` 属非破坏性「加索引」演进，不改契约字段。

### 4.4 迁移与发布

- 两张表**双注册**到 `migrateDB()`（`:271-303`）与 `migrateDBFast()`（`:327-356`），逐字对齐、顺序一致；两处当前本已不同步（`migrateDB()` 含 `&CasbinRule{}` / `&AuthzRole{}`），不可照抄单一列表。
- `SubscriptionPlan` 走独立 SQLite 分支，新表**不要**塞进该分支。
- `migrateLOGDB()` 只建 `&Log{}`；工单表**绝不进 LOG_DB**。
- 本期纯新增表、无存量行、无回填 → 三库均为 `CREATE TABLE`，无方言分叉；无需 raw SQL / `ALTER COLUMN` / 方言分支。
- 发布顺序：**先升级并完全启动 master 确认建表成功，再逐个滚动 worker**。worker 先起不会在启动期失败，缺表只在首个工单请求以 500 暴露。
- 原建议（实现阶段加，不改现有代码结构）：master 在 `migrateDB()` 返回前做 `HasTable("tickets")` / `HasTable("ticket_messages")` / `HasIndex` 只读断言，失败 panic；非 master 在提前 return 前做只读 `HasTable` 并 `common.SysError` 告警，不建表。**r2 裁决：本期不落地** —— §14.1 #7 已拍板「单实例 master、多实例一致性验收不作为阻断项」，该断言主要服务多实例滚动；单实例下等效门禁是下条的启动后 `unread-count` 探测，已足够测出缺表。保留为多实例演进项，不因本期未加而视为缺口。
- 启动后主动探测：每台实例带 `New-Api-User` 头打 **`GET /api/ticket/unread-count`**（该接口读 `tickets`，能测出缺表）；**不得用 `/api/status`**（不读 tickets，测不出缺表）。任一返回 `no such table`/5xx 即停止滚动。

---

## 5. 状态机与业务规则

### 5.1 四态与基本约束

- 建单 = `pending`。
- **删除自动状态联动**：管理员回复不自动 `pending→processing`，用户追问不自动 `resolved→processing`。
- **仅「真实状态变更」写一条独立 `kind='event'` 行**，不与 message 合并。产生 event 的路径恰为 5 条：① U6 `action=close` ② U6 `action=reopen` ③ A5 显式 status（值≠当前，含改成 `closed`）④ A4 回复显式带 status 且**值≠当前** ⑤ U5 `closed + reopen:true` 的重开 event。
- **不产生 event**：U5 普通追问（三态）、A4 未带 status、**A4 `status==当前`**、标记已读 U7/A6、同状态空转、U5 非 `closed` 下传 `reopen:true`。
- `pending` / `processing` / `resolved` **均可直接追问/回复，状态不变**；**仅 `closed` 禁止回复**（`ticket.status_not_replyable`）。该码同时适用于 **U5 对 `closed` 未带 `reopen:true`** 与 **A4 对 `closed`**（管理员无 reopen 能力，须先 A5 改到 `pending`）。
- `closed` 支持一步式「重开并继续回复」：U5 带 `reopen:true` 复合事务（event + message 共 2 条流条目），**合法、不返回错误码**。
- U6 只接受 `action=close|reopen`；U6 传 status 四值 → `ticket.invalid_params`；`U6 processing→reopen` → `ticket.invalid_transition`。A5 才接受四值 `status`，非法跳跃/非法值 → `ticket.invalid_transition`（A4 带非法 status 时**整笔回滚**）。
- **同状态空转 = no-op**：不写条目、不推水位、不改 `updated_at`、`changed=false`。
- 不设重开次数硬上限；次数如需统计从 `kind='event'` 的 reopen 事件聚合。

### 5.2 主动作表

| # | 动作 | 前置态 | 目标态 | event | 流条目 | `notify_target` | 角标效果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | U1 建单 | — | `pending` | 否 | 1 message | `admin` | 管理员 +1 |
| S2 | U5 用户追问 | `pending/processing/resolved` | 不变 | **否** | 1 message | `admin` | 管理员 +1 |
| S3a | A4 管理员回复（未带 status，或 status==当前） | 同上 | 不变 | **否** | 1 message | `user` | 用户 +1 |
| S3b | A4 显式带 status 且 ≠当前 | 同上 | 显式值 | 是 | 2（message+event） | 两条都 `user` | 用户 **+1 非 +2** |
| S4 | A5 管理员显式改状态（**含改成 `closed`**） | 四态 | 四值 | 是 | 1 event | `user` | 用户 +1（纯改状态也响） |
| S5 | U6 用户关闭 | `pending/processing/resolved` | `closed` | 是 | 1 event | **`none`** | **管理员不增不减** |
| S6 | U6 用户重开 | `resolved/closed` | `pending` | 是 | 1 event | `admin` | 管理员 +1（预期） |
| S7 | U5 `closed + reopen:true` | 仅 `closed` | `pending` | 是 | 2（event+message） | 两条都 `admin` | 管理员 +1 非 +2 |
| S8 | U7/A6 标记已读（**按工单**） | 任意 | 不变 | 否 | 0 | — | **该工单**对应侧未读消除；角标未必归零（该侧还有其他未读工单时仍 >0），幂等 |

### 5.3 `notify_target` 映射表（v3.1 核心裁决）

| 动作 | `kind` | `actor_role` | `notify_target` | 推进的 notify 列 |
| --- | --- | --- | --- | --- |
| 建单 / 用户追问 | `message` | `user` | `admin` | `last_admin_notify_id` |
| 管理员回复 | `message` | `admin` | `user` | `last_user_notify_id` |
| 管理员显式改状态（含 A5 改成 `closed`、A4 带 status≠当前） | `event` | `admin` | `user` | `last_user_notify_id` |
| **用户关闭** | `event` | `user` | **`none`** | **两个 notify 列都不动** |
| 用户重开 | `event` | `user` | `admin` | `last_admin_notify_id` |

- `notify_target='none'` **仅用于用户关闭**，不得扩用到 `resolved` 追加回复、用户重开或**管理员关闭**（A5→`closed` 走 `'user'`）。全库扫描 `notify_target='none'` 的行只能对应用户 U6 `action=close`。
- **用户关闭时**：`last_message_id` / `message_count` / `last_message_at` / 动作方 `user_last_read_id` / `updated_at` **照常推进**；仅 `last_user_notify_id` 与 `last_admin_notify_id` 两个 notify 列**严格不动** → 关闭前已有的管理员未读**既不增加也不清除**（A2 不变）；用户侧自身未读因 `user_last_read_id` 推进而清零（用户主动操作，合理）。**禁止实现「admin 水位被推进到关闭事件 id」**（作废口径，会一次性清零所有历史未读）。
- event 行 `content=""`、`actor_role` 为实际触发方（`user`/`admin`），不存 `system`；系统提示条**不渲染 actor**，只显示通用角色「管理员」的本地化文案，不暴露管理员账号或用户名快照。

### 5.4 事务与并发

- 所有写操作在单个 `model.DB.Transaction` 内；`now` 由 `common.GetTimestamp()` 在事务开始取一次、全程复用（**不用** `model/db_time.go` 的 `GetDBTimestamp()`，其 `DB.Raw` + 三库专有函数违反 §3.3 禁 raw SQL 约束）。
- 归属校验 `GetTicketForViewer(tx, ticketID, viewerID, viewerRole)` 是**唯一强制入口**，非管理员把 `user_id=?` 下推 SQL WHERE。
- **CAS 闸门前置到事务首条语句**：先发一条带 `id=? [AND user_id=?] AND status=基线 AND last_message_id=基线` 的条件 `Updates(map{"updated_at": now})`，`RowsAffected==0` 立即返回 `ticket.db_error` / 冲突并整体回滚 + 有界重试（≤2 次），再做事务内归属复读、状态机校验、60s 去重、流条目 INSERT、水位汇聚。原因：`model/locking.go:20-25` 在 SQLite 下 `lockForUpdate` 直接返回、`FOR UPDATE` 不生效，**不使用 `SELECT ... FOR UPDATE`**，改由首条条件 UPDATE 在 MySQL/PG 拿行锁、在 SQLite 靠单写模型串行；同时保证整事务 `created_at`（秒级）与全局自增 `id` 同序，让 `idx_message_ticket(ticket_id,id)` 覆盖详情流排序，避免并发下逆序导致 filesort/错序。
- **MySQL `clientFoundRows` 防御（r2 实现补强，采纳）**：仓库 DSN 未设 `clientFoundRows`，MySQL 默认 `RowsAffected` 是「实际改变行数」；若 CAS 首条 `SET updated_at=now` 与库内值相同（同秒写）会被误判为冲突。实现把整事务 `now` 取为 `max(common.GetTimestamp(), baseline.UpdatedAt+1)`，保证 CAS 的 SET 值必然变化，同时仍满足「整事务只取一次 `now`」「service 显式赋 `updated_at`」。副作用是高频同秒写入下 `updated_at` 最多超前数秒；该列仅作审计、不参与排序，接受。
- 最终水位 UPDATE 追加单调守卫 `WHERE last_message_id < 新id` 作双保险；`message_count` 用 `gorm.Expr("message_count + ?", n)`。
- 复合动作（2 条流条目）按「event 在前、message 在后」插入，逐条维护水位后汇聚为一次 `Updates(map)`；任一失败全回滚，**不产生半条消息**。
- **恒等不变量**：`tickets.message_count == COUNT(ticket_messages WHERE ticket_id=?) == U4.total`，历经建单/回复/改状态/关闭/重开/标记已读/并发回复后恒成立（标记已读不写条目，不改变三者）。
- 并发回复：`n1<n2` 来自单一自增序列，CAS 使最多一个 UPDATE 成功，另一个整体回滚（含已插入流条目）后重试，最终 `message_count=2`、`last_message_id=max(n1,n2)`，不丢计数不回退。回复+关闭并发：CAS 的 `status=基线` 使后提交者回滚，重试读到 `closed` 后被 `ticket.status_not_replyable` 拒绝，**closed 工单下不可能出现新回复**。
- 管理员未读**不得**由管理端列表查询顺带计算（列表只有当前页，会漏计全局角标），必须单独 `COUNT(*) WHERE last_admin_notify_id > admin_last_read_id`。

---

## 6. 未读角标机制

### 6.1 水位与 COUNT 公式

| 侧 | 通知水位 | 已读水位 | 未读 COUNT |
| --- | --- | --- | --- |
| 用户 | `last_user_notify_id` | `user_last_read_id` | `COUNT(*) WHERE user_id=? AND last_user_notify_id > user_last_read_id` |
| 管理员 | `last_admin_notify_id` | `admin_last_read_id` | `COUNT(*) WHERE last_admin_notify_id > admin_last_read_id`（逐行**行内两列比较**，无 `user_id` 条件） |

- 角标 = **有新动态的工单数**，不是事件条数：连发 3 条回复 / 连改 2 次状态，角标仍为 1。
- 水位用**自增流条目 id**，不用秒级时间戳（避免同秒碰撞漏计/重复）。
- **四个水位列都是 `tickets` 的行级字段，每个工单一份**；标记已读是**按工单**的（U7/A6 均带 `:id`）：`SET <侧>_last_read_id = last_message_id WHERE id=? [AND user_id=?] AND <侧>_last_read_id < last_message_id`，单调幂等、**不改 `updated_at`**；只消除**该工单**在对应侧的未读，角标为该侧剩余未读工单数。
- **「管理员全局共享」的准确含义**：`admin_last_read_id` **不是**「系统一个全局整数」，也**不按管理员各存一份**；它是每个工单一行的列，**所有管理员共享同一份**。任一管理员对该工单调 A6，清掉的是**该工单对所有管理员**的角标，其他工单不受影响。接口注释必须写明，避免实现者误做成「一次 A6 清空全部工单」或「按管理员建 `ticket_read_receipts` 表」。

### 6.2 轮询策略

- 常量 `TICKET_UNREAD_POLL_MS = 30_000`（前端**构建期常量**，不新增环境变量），详情页复用同一常量、不新增独立定时器。
- **I 运行时不可调**：`go:embed` 使前后端为单一构建单元，调整轮询间隔必须整体重建镜像并重启，**无法灰度/降级**。故部署侧「故障时调大 I 降 DB 压力」不成立，唯一降级手段是重新发版；容量预案改为 §14.2 的索引 / COUNT 优化。
- 页面隐藏暂停（`refetchIntervalInBackground: false`）、重新可见立即拉取。
- 失败退避 30 → 60 → 120s 封顶；失败保持上次成功角标，**不清零、不闪烁**。退避会**降低**实际 QPS，稳态按 `I=30s` 估算即可，勿把「30s 稳态」与「120s 故障态」叠加算成更坏压力。
- 详情页**进入时**调一次 `POST /api/ticket/item/:id/read`（按工单）；轮询到新条目**不自动标记已读**。

---

## 7. API 契约

### 7.1 路由分组与中间件顺序

- 用户组 `/api/ticket`（`UserAuth()`），管理组 `/api/ticket/admin`（`AdminAuth()`，role ≥ 10）。
- 父组链：`RouteTag("api")` → `gzip` → `BodyStorageCleanup()` → `GlobalAPIRateLimit()` → 分组鉴权 → 按路由挂 `CriticalRateLimit` / `TicketWriteRateLimit` / `SearchRateLimit`。
- **用户级限频必须挂在鉴权之后**，否则 `id=0` 会被直接 401。
- 第一层全静态、`:id` 下沉到 `/item/` 下，避免 `/ticket/admin` 被 `:id` 抢匹配。
- 不接 `authz.RequirePermission`；`SUPER_ADMIN` 本期无额外特权。

### 7.2 13 个接口

| # | 方法 / 路径 | 请求 | 响应 data | 事务 |
| --- | --- | --- | --- | --- |
| U1 | `POST /api/ticket/` | `title`, `content` | `CreateView` | 是 |
| U2 | `GET /api/ticket/` | `p,page_size,status?` | `PageInfo<TicketSelfView>` | 否 |
| U3 | `GET /api/ticket/unread-count` | — | `{count, scope:"self"}` | 否 |
| U4 | `GET /api/ticket/item/:id` | — | `DetailData` | 否 |
| U5 | `POST /api/ticket/item/:id/reply` | `content, reopen?` | `WriteResultView` | 是 |
| U6 | `PUT /api/ticket/item/:id/status` | `action:close\|reopen` | `WriteResultView` | 是 |
| U7 | `POST /api/ticket/item/:id/read` | — | `{changed, count, last_read_id, scope:"self"}` | 否 |
| A1 | `GET /api/ticket/admin/` | `p,page_size,keyword,status?` | `AdminListData` | 否 |
| A2 | `GET /api/ticket/admin/unread-count` | — | `{count, scope:"global"}` | 否 |
| A3 | `GET /api/ticket/admin/item/:id` | — | `DetailData(TicketAdminView)` | 否 |
| A4 | `POST /api/ticket/admin/item/:id/reply` | `content, status?` | `WriteResultView` | 是 |
| A5 | `PUT /api/ticket/admin/item/:id/status` | `status:四值` | `WriteResultView` | 是 |
| A6 | `POST /api/ticket/admin/item/:id/read` | — | `{changed, count, last_read_id, scope:"global"}` | 否 |

> **响应字段统一为 `count`**（`unread_count` 作废）：U3/A2/U7/A6 共用一套字段，前端 React Query 只缓存一份。`WriteResultView` 含 `changed` / `status` / `message_count` / `last_message_id` 等元数据，**不回显 title / content**。

### 7.3 关键响应约定

```
DetailData  { ticket, replies:[]MessageView, total:int, has_more:bool }
MessageView { id, ticket_id, kind, actor_role, author_user_id, author_username,
              content, event_type, from_status, to_status, notify_target, created_at }
```

- **U4 不做分页**：无 `offset` / `cursor` / `p/page_size`，本期也无历史分页接口。取**最近 200 条**：`WHERE ticket_id=? ORDER BY created_at DESC, id DESC LIMIT 200` → **Go 内反转**为 `created_at ASC, id ASC` 正序返回。因 §5.4 保证同事务内 `created_at` 与 `id` 同序，该排序可由 `idx_message_ticket(ticket_id,id)` 反向扫描满足；三库同秒并列由 `id` 兜底。**必须取「最近 200」而非「最早 200」**（传 `p/page_size/cursor/offset` 一律被忽略、结果与不带参数一致、不报错）。
- `total = tickets.message_count`（含 event 行）；`has_more = total > 200`，恒满足；**event 行同样计入这 200 条与 `total`**。页面「回复数」按 `kind='message'` 过滤，与 `total` 区分展示；`has_more=true` 时显示「仅显示最近 200 条消息」，不承诺可翻页。
- `kind='event'` 行 `content` **恒为 `""`**（不是 `NULL`），状态信息在 `event_type`/`from_status`/`to_status` 结构化列，不存 JSON、不存译文；事件文案由前端按参数化 i18n key 拼装，后端不存译文。
- `replies[]` 恰含上列 12 个字段，无额外泄露字段；**用户侧响应不得夹带管理员账号**（`TicketSelfView` 也不返回 `admin_*` 水位）；管理端 `TicketAdminView` 额外含 `user_id, username, last_admin_notify_id, admin_last_read_id`。
- **越权 / 不存在时 `data` 必须整体为空**：响应体**连 `ticket` / `replies` / `total` / `has_more` 任一键都不能出现**（`total:0`、`has_more:false` 也不给，否则泄露条目数），与「不存在 id」响应逐字节同构。
- `tickets` 表**无 `content` 列**：工单原正文 = `ticket_messages` 第一条 `kind='message'` 行，即详情正序 `replies[0]`；`has_more=true` 时该行被截断，本期只给提示、不新增字段。
- 列表 `data` 直接是 `common.PageInfo` 本体（`items/total/page/page_size`，参照 `controller/redemption.go:17-27`）；管理端 A1 额外多一个可选 `data.search_notice`（**值为稳定无点号 i18n key，由前端本地化，见 §7.6**）。两个 PUT 的 `action`/`status` 走 JSON body，`p/page_size/status/keyword` 走 query string。

### 7.4 长度与计数口径

| 字段 | 上限 | 后端 | 前端 |
| --- | --- | --- | --- |
| `title` | 1–200 rune | `utf8.RuneCountInString` | `[...str].length` |
| `content` | **≤ 8000 rune 且 UTF-8 ≤ 64 KiB，取先到者** | `utf8.RuneCountInString` + `len([]byte(s))` | `[...str].length` + `TextEncoder` |

- **禁用 JS `String.length`**（UTF-16 码元 ≠ rune）。
- **「取先到者」= 两个条件都算、任一超限即拒**：反例 20000 个 ASCII = 20,000 B（<64 KiB）但 rune=20000 必须被 rune 校验拒绝；8000 个 4 字节 emoji = 32,000 B 且 rune=8000 合法。
- **64 KiB 计量口径裁决**：按 Go **解码后字符串** `len([]byte(s))` 计，不按 HTTP/JSON wire 原始 body 字节（wire 含转义会虚高）。实现时字节阈值写作 `<= 65535`（或 `< 65536`），严格落在三库 `type:text` 内（MySQL `TEXT` 上限 65,535 B）；因 8000 rune × 4 B = 32,000 B，正常路径永不触及，此为防御性兜底。
- **rune 超限与字节超限统一返回 `content_too_long`**，不区分两侧（「取先到者」是内部实现细节，对外单一错误码）。错误码族：`title_empty` / `title_too_long` / `content_empty` / `content_too_long`。
- controller 与 service **双重校验**；`TrimSpace` **仅用于非空判定、不改写存储值**（提交 `"  abc  "` 读回仍是 `"  abc  "`，与 60s 去重 byte-equal 一致）；超限明确报错、**不静默截断**、不落库。SQLite `varchar(200)` 不校验长度，应用层是唯一防线。

### 7.5 错误码与越权语义

| code | HTTP | 触发 |
| --- | --- | --- |
| `ticket.invalid_params` | 200 | id 非法、缺字段、**U6 收到 status 四值** |
| `ticket.title_empty` / `title_too_long` | 200 | 标题 |
| `ticket.content_empty` / `content_too_long` | 200 | 正文 |
| **`ticket.not_found`** | **200** | **不存在 / 越权 / CAS `RowsAffected==0`** |
| `ticket.status_not_replyable` | 200 | `closed` 下 U5 未带 `reopen:true`、**A4 对 `closed`** |
| `ticket.invalid_transition` | 200 | 非法状态值或非法迁移（U6 `processing→reopen`、A5 非法跳跃、A4 非法 status 整笔回滚） |
| `ticket.duplicate` | 200 | 60s 内容去重命中 |
| `ticket.rate_limited` | **429，无 body** | 三层限频（`c.Status(429)`，无 JSON body、无 code） |
| `ticket.db_error` | 200 | GORM 错误 / 事务回滚 / 重试用尽 |

- **越权 = 业务语义 `ticket.not_found` + HTTP 200 + `success:false` + `data` 整体为空**，不是 HTTP 404。理由：与仓库信封一致、不泄露存在性（不存在与他人 id 逐字节同构、键集合一致）、避免前端误判登录失效。产品侧文中「统一 404」指**防枚举的业务语义**，已被此裁决澄清。
- `code` 为硬编码机器字符串、不走 i18n；`message` 走 `common.TranslateMessage` + `i18n/keys.go` 既有通用键，后端不新增 YAML 键。
- `AdminAuth()` 权限不足的响应**没有 `code`**；8 语言验收需断言 message 不出现原始 i18n key。
- 因 `common/gin.go` 在冻结清单外，controller 用 `ticketFail()` 镜像 `ApiErrorI18n` 信封并追加 `code`。

### 7.6 限频、去重与搜索

| 层 | 覆盖 | 阈值 |
| --- | --- | --- |
| `GlobalAPIRateLimit` | `/api` 父组，IP | 360/180s |
| `CriticalRateLimit` | U1 / U5 / A4，IP | 20/20min |
| `TicketWriteRateLimit` | U1/U5/U6/A4/A5，用户 | **5 次/60s（用户拍板定值，§14.1 / 附录 A 第 11 条）** |
| `SearchRateLimit` | A1，用户 | 10/60s |
| 60s 内容去重 | service 层 | `(author_user_id, ticket_id, raw content, 60s)` |

- `TicketWriteRateLimit()` 用包内未导出常量、复用 `userRateLimitFactory(5, 60, "TW")`（**§14.1 #1 用户拍板 5 次/60s**，实现已按此落地；早期 prose 曾写 10 次，r2 已更正），**mark 前缀 `"TW"`**（Redis key `rateLimit:TW:user:<id>`）；**不新增任何环境变量**、不改 `common/constants.go`；所有 duration 不得超过 `RateLimitKeyExpirationDuration=20min`。因无环境变量，调阈值须改常量并重新构建，无运行时旋钮。
- U7 / A6 **不受** `TicketWriteRateLimit` 约束（幂等读水位更新，成本极低）。
- 去重对原始 content **精确匹配、不归一化**；复合 `reopen:true` **不参与**内容去重。
- 窗口为**滑动日志**；切换 `REDIS_CONN_STRING` 需**重启**（限频闭包在启动期生成），Redis off 时进程内 map 重启即丢属预期；**Redis 只承载限频计数**，未读/状态/回复/水位全在 `model.DB`，Redis 故障不应产生任何数据类失败。
- **429 必须从 5xx 错误率分子中排除**：压测/灰度打靶时限频命中的 429 单独计数，否则正常限频会误触发回滚告警。
- A1 搜索范围 = 标题 + 工单 ID + 提交人用户名，**不含回复正文**；用户名先精确解析成 `user_id` 再查，`ids` 为空必须直接短路返回，**绝不把空 `IN (?)` 拼进查询**（会退化全量）；`LIKE ? ESCAPE '!'`；用户名一次 `IN (?)` 批量回填，禁 N+1，且**必须 `Unscoped()`**（users 有软删 `DeletedAt`，否则已注销用户用户名为空）。A1 单独调用、一页 50 条时 SQL 条数**与 `page_size` 无关、无 1+N**：`keyword=""`（前端默认场景）恰 **3 条**（`COUNT(*)` + 列表 + 一次 `IN` 回填）；带非空 keyword 时 **3~4 条**（多一次用户名精确解析，解析结果复用进回填 map 则仍为 3）。**验收硬断言 3 条只针对默认场景**，不要求带 keyword 也恒为 3（内联子查询虽可压到 3，但会引入额外复杂度，本期不做）。
- **搜索命中口径（r2 澄清）**：用户名不存在/已删/重名**不等于**整体无结果 —— 标题或工单 ID 有命中时**正常返回结果并附 `search_notice`**；仅当三种范围**全部无命中**才返回 `{total:0, items:[], search_notice}`、不报错。早期 prose「用户名不存在 → `total:0`」按此澄清作废，否则标题/ID 搜索会整体失效。注意「搜索时精确解析 user_id」与「列表展示时 `IN` 回填」是两条不同路径，不可混用。
- **`search_notice` 是稳定无点号 i18n key，不是本地化句子**（r2 实现口径）：取 `Ticket Search Notice No Username` / `Ticket Search Notice Multiple Usernames`，由前端白名单 + `t()` 映射 en/zh；其余语言 fallback en。**不得含点号**（`i18n/config.ts` 的 `keySeparator` 仍为默认 `'.'`，见 §1.3 F2）。旧版后端返回英文纯句子时前端按白名单外原样展示，平滑降级。
- `search_by` 下拉**不做**，仅提示文案（后端参数保留但不暴露给 UI）。

---

## 8. 前端设计

### 8.1 菜单与路由

| 分组 | 路径 | 文案 key | 图标 | 角标 |
| --- | --- | --- | --- | --- |
| `Personal` | `/tickets` | `'My Tickets'` | **`LifeBuoy`** | 用户未读数 |
| `Admin` | `/ticket-management` | `'Ticket Management'` | **`LifeBuoy`** | 管理员全局未读数 |

- **禁止使用 `Ticket` 图标或 key**（准确理由见 §1.1 第 3 条：lucide 标识符 / 命令面板搜索 / React key 歧义，**非** i18n key 撞车）。
- 管理端 `beforeLoad`：`role < ROLE.ADMIN` → `redirect('/403')`。
- **角色门控**：`command-menu.tsx` 不过滤角色（§1.3 F5），新增的两个工单入口须在该处显式按 `role` 过滤；是否修既有 Admin 项见 §14.1 #13。
- **不新增 `URL_TO_CONFIG_MAP` 映射**（§1.3 F6）：未映射 URL 默认可见；详情页用 `?id=` search param 页内面板，不新增第三路由。

### 8.2 用户端 `/tickets`

- 列表（状态筛选 + 分页）、新建工单表单、详情对话流、回复框、关闭/重开操作。
- `pending` 态关闭需**二次确认**。
- 系统事件渲染为**居中轻量系统提示条**，纯系统文案、**不含任何用户输入**、不渲染 actor、参数化 i18n key；只显示通用角色「管理员」。
- `has_more=true` 时显示「仅显示最近 200 条消息」；**不得实现翻页 / 无限滚动**（本期无历史分页接口）。
- 提交框/回复框上方 i18n 提示「请勿粘贴密钥 / Token 等敏感信息」（**仅提示，服务端不检测不打码**）。

### 8.3 管理端 `/ticket-management`

- 全量列表、状态筛选、搜索框（附搜索范围提示）、详情对话流、回复框、状态下拉（默认 = 当前状态）。
- 状态下拉只在**显式改变**时才传 `status`（选当前状态 = no-op，不写 event），避免每轮回复都写一条「状态未变化」事件刷屏。
- `closed` 态无法回复，需先 A5 改到 `pending`。

### 8.4 轮询 hook

- `useQuery(['ticket','unread'], ..., { refetchInterval: TICKET_UNREAD_POLL_MS, refetchIntervalInBackground:false })`；**必须显式覆盖**全局 `refetchOnWindowFocus:false` / `staleTime`（§1.3 F4）。
- `queryFn` **必须吞掉 `AxiosError` 并返回上一次成功角标，绝不抛出**（全局 `queryCache.onError` 对 500 会导航 `/500`，§1.3 F4）；页面可见性监听 + 失败退避 30→60→120s + 失败保持上次角标，均以此为前提。
- 进入详情页按工单调一次 `POST /api/ticket/item/:id/read`；轮询追加消息用稳定 `key={id}`，不重挂载输入框、不重置草稿。

### 8.5 i18n

- **只改 `en.json` + `zh.json`**；其余 6 语 fallback 到 en。
- **不跑 `i18n:sync`**（避免 6 语大 diff）；CI 无 i18n 门禁（backend 已核实）。
- 新增 key：`'My Tickets'`、`'Ticket Management'`、四状态名（**带前缀**，见下）、系统事件参数化 key、错误码文案、敏感信息提示、搜索范围提示、共享水位说明、`'仅显示最近 200 条消息'`。
- **四状态 key 必须带前缀**：`'Ticket Pending'` / `'Ticket Processing'` / `'Ticket Resolved'` / `'Ticket Closed'`，因裸 `'Pending'` 已被占用且中文为「待确认」（§1.3 F3）。
- **错误码不得直传 `t()`**：`keySeparator` 默认 `'.'`（§1.3 F2），须经 `code → 无点号英文短语 key` 映射；用户可见错误优先展示后端 `message`。

---

## 9. 安全、日志与审计

- 归属下推 SQL；请求体不含 `user_id`（DTO 定义在 controller 本地，Gin 忽略未知字段）；事务内二次 `WHERE user_id=?` 防 TOCTOU。
- **日志硬规则**：自写日志点（`common.SysLog` / `common.SysError` / `RecordOperationAuditLog` / 错误上报 / 埋点）只允许 `op / ticket_id / viewer_id / role / status / code / request_id / rows / elapsed_ms / err(裁剪)`；**绝对禁止**把工单标题、正文、回复内容拼进 `common.SysError` / `c.Error` / 埋点，不 `%+v` 打印 model 结构体，不在错误响应回显正文。管理端 A4/A5/A6 经 `beginAdminAudit` 天然留痕（`action="generic"`，`opParams` 自带 `method`+`route`）；按 `method+route` 建语义化 action 属后续演进，本期不做。
- **现有 HTTP 访问日志的准确边界**：`middleware/logger.go` 的 formatter 只输出 8 个元数据字段，**不记 body / header / `c.Errors` / `c.Keys`**，因此无需为工单路由加脱敏层（加脱敏层是全局改动且越界）。但 `gin/logger.go` 把 `URL.RawQuery` 拼进 `param.Path` → **query string 会明文进 `[GIN]` 访问日志**：A1 的 `keyword`（及 `status`、分页参数、可选 turnstile token）可见。`keyword` 是检索词而非落库 `tickets.title` / `ticket_messages.content`，不违反禁令字面。处置为运维侧三条：① 禁止把正文/整段标题当 keyword 使用；② 访问日志与业务日志同等访问控制与保留期；③ 若需零残留则改 formatter，属全局改动 + 越界，列后续演进。
- 若日后新增任何访问日志，**切勿打印 `c.Request.URL.RawQuery`**。
- 失败路径由 controller 取 `X-Oneapi-Request-Id` 关联日志。
- 本期**不接** `TurnstileCheck()`（若日后接入，唯一挂点为 U1，且须放在本地限频之后；其失败响应无 code、message 中文硬编码需单独兼容）。
- 工单与消息长期保留作审计轨迹，本期无删除/编辑/撤回接口；备份纳入主库 `DB` 现有方案、介质加密，**不得依赖 `LOG_DB`**（TTL 会丢数据）。

---

## 10. 测试与验收

### 10.1 必测分组

| 组 | 内容 |
| --- | --- |
| 三库 × Redis 六组合 | SQLite / MySQL / PG × Redis 开关，各跑一遍双注册建表与全流程。**必须在 CI 之外搭**（见 §1.2 / §14.2） |
| 迁移 | `migrateDB()` / `migrateDBFast()` 双注册静态断言；master 优先滚动；每台实例带 `New-Api-User` 头主动打 `GET /api/ticket/unread-count` 探测缺表 |
| 契约 12 类 | 两表三索引、`go:embed` 整体重建、13 条 `FullPath()` 不 panic、第一层全静态 |
| 越权 AC-1~AC-6 + U4–U7 | 不存在与他人 id 逐字节同构、**`data` 键集合全空**（连 `total:0` 都不给）、U5/U6/U7 后 DB 零写入、夹带 `user_id` 无效、篡改 `New-Api-User` → 401、普通用户打 A5 被拦、普通用户向 U6 传 status 四值被拒 |
| 状态机与水位 | 8 种流程；**5 条 event 产生路径 + 6 条不产生路径反向枚举**；A4 带 `status≠当前` 2 条流条目但角标 +1；**A4 `status==当前` 只 1 条 message 不写 event**；纯改状态用户角标仍响；管理员 A5→`closed` 用 `'user'` 而非 `'none'`；关闭不增不减管理员未读；重开 +1（先固定「关闭前管理员未读为 0」基线）；同态空转 no-op；`reopen:true` 复合事务全回滚；错误码矩阵 8 条 |
| 长度边界 | 200/201 rune、8000/8001 rune、全角/emoji 混合（含组合 emoji/ZWJ）、64 KiB 边界、20000 ASCII（须被 rune 校验拒绝）、纯空白/零宽字符、空串；**controller + service 双重校验**；`TrimSpace` 不改写存储值；三库写回读 `==` 逐字一致；**SQLite 验证 `varchar(200)` 不拦超长**；MySQL `utf8mb4` vs `utf8` 各跑 emoji 用例；超限报错不截断 |
| 并发 | N 次并发回复 `message_count` 增量 = N、`last_message_id` 严格单调；**`message_count == COUNT(*) == U4.total` 三者恒等**；CAS 冲突事务整体回滚无孤儿流条目；回复+关闭并发下 closed 工单无新回复 |
| 性能基准 | A1 单独调用、一页 50 条 SQL 条数 = **3 常数**（COUNT + 列表 + 一次 `IN` 回填，须 `Unscoped()`），不出现 1+N；三库 `EXPLAIN`：用户未读 COUNT 在 ≥1000 行时应出现 `idx_ticket_user_status`（小表允许 `ALL`/`Seq Scan`，不写硬断言）、**管理员全局 COUNT 三库必然全表扫描，只断言数值正确 + 无排序/临时表 + P95 阈值**、A1 列表应出现 `idx_ticket_status_activity`（允许 PG/SQLite 的 `Sort`/`TEMP B-TREE`） |
| 限频/去重/降级 | 429 空 body、**429 不计入 5xx 错误率**；**写限频 5 次/60s：U1 连续第 1–5 次成功、第 6 次 429**（§14.1 #1 拍板值）；U7/A6 不受写限频；60s 原始 content 精确匹配；Redis 关闭时进程内限频仍生效且未读不受影响 |
| 详情 200 上限 | **取最近 200 而非最早 200**、`replies` 正序、`total == message_count`（含 event）、`has_more = (total>200)`、event 计入 200、`content=""`（**非 NULL**）、传分页参数被忽略、本期无历史分页接口 |
| 日志脱敏 | 构造含 `sk-` 假密钥正文，扫描日志/审计/埋点不出现标题、正文、回复；**API 响应层**也断言用户侧不夹带管理员账号 |
| 前端 | 菜单入口与角标、轮询退避与失败保持、系统提示条不含用户输入、无翻页/无限滚动、i18n 8 语言无原始 key、`go:embed` 整体重建、CF/源站缓存 Purge 后旧页面不再复现；**r1 追加 6 项**：① 错误码经映射后不回显 `ticket.xxx` 原始 key（`keySeparator`，§1.3 F2）；② 工单 `pending` 显示专属文案、**不串成「待确认」**（§1.3 F3）；③ 轮询接口返回 500 时页面**不跳 `/500`**、角标保持上次值（§1.3 F4）；④ 普通用户命令面板搜不到 `/ticket-management`（§1.3 F5）；⑤ 两新路由未加 `URL_TO_CONFIG_MAP` 映射且默认可见（§1.3 F6）；⑥ 详情页走 `?id=` 页内面板、路由表仅新增 2 条、无第三路由 |

### 10.2 Release Gate

三库各跑通 + 双注册静态断言 + 越权全拦截 + 8 种流程 + `message_count` 恒等 + 日志脱敏抽查 + 200 上限（最近 200）+ 前端缓存验证，全部通过方可合并。**阻断项**另含：A4 `status==当前` 误产生 event、任意真实状态变更路径未产生 event、`notify_target='none'` 出现在非用户关闭动作、越权时 `data` 出现 `total`/`has_more`/`replies`/`ticket` 任一键。任一项失败视为阻断。

**区分「缓存」与「真部署失败」四项判据**：① 容器 `.Image` == 目标 digest ② 直连源站 `GET /api/ticket/unread-count` 正常 ③ 直连源站 HTML 引用**新** JS hash ④ CDN 返回 HTML 与源站一致。①②③ 满足而浏览器仍旧 = 缓存问题（Purge + 刷新指引）；任一不满足 = 部署失败（回滚/重建）。`?v=` 仅改 cache key，不作为修复判据。

---

## 11. 部署、发布与回滚

### 11.1 构建与镜像

- push 到 `main` 触发 `.github/workflows/ghcr-build.yml` 构建 `ghcr.io/aunt-lee/new-api-1:latest` / `main` / `sha-<短sha>`（仅 linux/amd64）。
- 前端 dist 经 `go:embed` 编进单一二进制，**前后端必须整体重建重启**。

### 11.2 生产更新命令

```bash
cd /opt/new-api
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --pull always --force-recreate --no-deps new-api
```

`--no-deps` 防止把 db / redis 一起重启拉长停机。`docker-compose.prod.yml` 与 `.env.prod` 只在服务器上、不在仓库。

### 11.3 发布顺序

1. 确认 GHCR 构建 success，核对 `latest` digest 与目标 `sha-<短sha>` digest 一致。
2. **先更新 master**（唯一执行 AutoMigrate 的实例），确认两张表与三个索引已建立。
3. 再逐个滚动 worker（须显式 `NODE_TYPE=slave`）。
4. 每台实例启动后带 `New-Api-User` 头主动探测 `GET /api/ticket/unread-count`（不用 `/api/status`）；通过才切流量。

### 11.4 缓存处理（必需步骤）

- 源站 `middleware/cache.go` 对除精确 `/` 外所有路径给 1 周 TTL，**这是「容器已最新但页面仍旧版」的源站根因**。
- 发布后**先 Purge Everything**（或按 URL：`/`、`/index.html`、`/assets/*` + 两个新前端路由，路径以 `routeTree.gen.ts` 为准），**Purge 后再验证，别反过来**；**回滚后同样要再 Purge 一次**。
- 验证手法：无痕窗口/全新 profile → `?v=<SHORT>` 绕过 cache key（不是修复）→ 看 `cf-cache-status`（HIT 可疑 / MISS·DYNAMIC·BYPASS 已回源）与 `Age` → 直连源站（`curl --resolve <BASE>:443:<ORIGIN_IP>`）比对 `index.html` 引用的 JS 文件名与 CDN 返回是否一致 → 检查 `/assets/*` 404 率。
- 直连比对前确认 `FRONTEND_BASE_URL` 为空，否则非 master 实例会 301，拿到 301 而非 HTML 造成误判。
- **`VERSION` 为空文件、`X-New-Api-Version` 响应头为空，不能用于判断新旧版本**，只能用 digest / commit sha。

### 11.5 回滚

- 代码回退即可，**不删表、不删列**（纯新增表，老代码完全不感知，残留空表无副作用）。
- 回滚镜像后按 11.4 再 Purge 一次缓存。
- 灰度观测：审计留痕覆盖率 100%（`action=generic`，按 `method+route` 建规则）、静态资源 404 率突增 → 判为 CDN 旧 HTML 引用已下线 hash、**工单接口错误率口径必须排除 429**。

---

## 12. 实施拆解

| 阶段 | 内容 | 并行度 |
| --- | --- | --- |
| P1 数据层 | `model/ticket.go`、`model/ticket_message.go`、`model/main.go` 双注册 | 单线程，先行 |
| P2 服务与接口 | `service/ticket.go`、`controller/ticket.go`、`middleware/rate-limit.go`、`router/api-router.go` | 依赖 P1 |
| P3 前端 | `features/tickets/`、`features/ticket-management/`、`use-sidebar-data.ts`、两个路由文件、i18n | 可与 P2 并行（按契约 mock） |
| P4 联调 | 三库 × Redis 六组合（**CI 之外搭**）、越权与并发、长度边界 | 依赖 P2+P3 |
| P5 发布 | GHCR 构建、master 优先滚动、主动探测、Purge 缓存 | 依赖 P4 |

每阶段自验：Go `gofmt -l` + `go build ./...`；前端 `cd web/default && bun run typecheck`；提交信息带 `Co-Authored-By: WorkBuddy <noreply@workbuddy.ai>`。

---

## 13. 决策与权衡（被否决方案记录）

| # | 被否决方案 | 采纳方案 | 理由 |
| --- | --- | --- | --- |
| 1 | `ticket_replies` + `last_reply_role` 二值 + 事件存 JSON 字符串 | `ticket_messages` + 结构化列 + `notify_target` | 纯改状态无法驱动未读；JSON 跨库/译文存储脆弱；独立 event 行渲染简单 |
| 2 | 自动状态联动（管理员回复 `pending→processing`、用户追问 `resolved→processing`） | 删除，状态只由显式动作改变 | 附带事件污染时间线，用户无法预期 |
| 3 | `resolved` 须先重开才能追问 | 仅 `closed` 禁止回复 | 降低用户摩擦；追问写 message + `notify_target='admin'` + 管理员角标已覆盖「漏看」顾虑 |
| 4 | 合并流条目（message 行带 event 字段） | 每次真实状态变更写独立 event 行 | 前后端分流清晰，`message_count` 口径自洽 |
| 5 | 5000 rune / 16 KiB / 32 KiB | 8000 rune 且 64 KiB，取先到者 | 统一前后端口径；8000×4=32000 B < MySQL TEXT 65535 B，三库不截断 |
| 6 | 500 条流上限 / 2000 行 + 50 条分页 | 最近 200 条 + `total`/`has_more`，本期不分页 | 控制响应体与首屏成本，避免提前引入分页协议 |
| 7 | 越权 HTTP 404 | 业务 `ticket.not_found` + HTTP 200 信封 + `data` 键集合全空 | 与仓库一致、防枚举、避免前端误判登录失效 |
| 8 | R3 用户关闭推进 `admin_last_read_reply_id` 到关闭事件 id | `notify_target='none'`，两个 notify 列都不动 | 旧法会**清零管理员历史未读**；新法两个操作数都不写，数学上严格不增不减 |
| 9 | Redis 参与未读 | DB 水位唯一真源 | 避免双写一致性与故障域 |
| 10 | 未读按事件条数 | 按「有新动态的工单数」 | 连发多条不应让角标暴涨 |
| 11 | `search_by` 下拉 | 仅提示文案 | 简化 UI，避免空 `IN` 退化全量的额外分支 |
| 12 | 详情页轮询到新条目自动标记已读 | 仅进入详情时按工单调一次 `/read` | 避免「没看到就算已读」 |
| 13 | 本期接 `TurnstileCheck()` | 不接，保留演进 | 已登录 + 三层限频 + 去重足够；其失败响应无 code 需额外兼容 |
| 14 | 按管理员独立未读水位 `ticket_read_receipts` | 每工单一行 `admin_last_read_id`，所有管理员共享 | 本期简化；未来「只加表」演进，旧列永久保留 |
| 15 | 用户注销后工单匿名化/清理 | 不匿名化、不清理 | 保留审计轨迹；用户表软删不级联业务表 |
| 16 | 附件/优先级/内部备注/邮件/WebSocket/SSE | 一律不做，不预留字段 | 避免为未来能力预置无用列 |
| 17 | 轮询间隔 I 用运行时 env 可调 / 故障时调大 I 降级 | 前端构建期常量 `TICKET_UNREAD_POLL_MS=30_000` | 与「不新增环境变量」一致；`go:embed` 决定运行时改不了，降级只能重新发版 |
| 18 | event 行 `actor_role='system'` | `kind='event'` 标识系统事件，`actor_role` 存实际触发方（`user`/`admin`） | `author_user_id`/`author_username` 已能溯源，不必凭空造「系统」身份 |
| 19 | 64 KiB 按 HTTP wire body 字节 / rune 与字节超限分不同错误码 | 按 Go 解码后字符串 `len([]byte(s))`；统一 `content_too_long` | wire 含转义会虚高；单一错误码避免对外泄露计量实现 |
| 20 | 假设 CI 会跑三库兼容矩阵 | C1–C6 在 CI 之外（本地/预发）搭建 | 6 个 workflow 均无 DB 容器、无 `go test`/`bun test`/Playwright 步骤 |
| 21 | 补第 4 个 `idx_ticket_user_activity(user_id, last_message_at)` 消除 U2 filesort | **保持 3 索引，本期接受 filesort** | 纯新增表、单用户工单数有界、避免写放大；补索引属非破坏性演进，压测不达标再做 |
| 22 | `idx_ticket_admin_notify` 单列索引优化管理员全局 COUNT | **作废该提法**，改为「冗余标志列 + 离线对账」或接受扫表；本期选后者 | 同行两列相比，B-tree 无法范围裁剪，加索引无效；PG 部分索引三库不一致禁用 |
| 23 | `admin_last_read_id` 为系统全局单值 / S8「对应侧归零」 | 四个水位均为 `tickets` 行级字段；U7/A6 按工单标记，只消除该工单未读，角标未必归零 | 旧表述会误导实现成「一次 A6 清空全部工单」或按管理员分表 |

---

## 14. 风险与待确认

### 14.1 参数拍板结果（2026-11-06，**下表为实现唯一依据**）

> 13 项已全部定案：`【用户拍板】`为用户直接选定，`【默认执行】`为主理人按建议值落地。本节不再存在待确认项。

| # | 事项 | 最终值 |
| --- | --- | --- |
| 1 | `TicketWriteRateLimit` 阈值 | **【用户拍板】5 次 / 60s**（严于建议值 10 次；滑动日志，mark `"TW"`，无环境变量，改值须改常量重建镜像）。验收改为「前 5 次成功、第 6 次 429」 |
| 2 | CAS 冲突有界重试次数 | 【默认执行】≤ 2 次 |
| 3 | 60s 内容去重窗口、是否引入 `Idempotency-Key` | 【默认执行】本期仅 60s 去重，不引入幂等键 |
| 4 | `code` 实现路径（`ticketFail` 镜像 vs 扩展 `common/gin.go`） | 【默认执行】用 `ticketFail` 镜像，冻结清单不含 `common/gin.go` |
| 5 | 尾斜杠 301（`GET /` 注册为 `/api/ticket/`） | 【默认执行】前端统一带尾斜杠 ＋ 组内补 `GET ""` 别名（双保险） |
| 6 | 管理端审计 `action="generic"`、用户侧无审计留痕 | 【默认执行】本期接受 |
| 7 | 多实例上线拓扑与「多实例一致性验收」是否阻断 | **【用户拍板】单实例 master**：建表迁移一次完成，多实例一致性验收**不作为阻断项**；仍保留 `migrateDB`/`migrateDBFast` 双注册与 slave 显式 `NODE_TYPE=slave` 的防御写法（不改代码结构，零额外成本） |
| 8 | 在线人数 / QPS / 延迟预算（P95 基线、错误率/慢查询阈值、灰度窗口、回滚 N 倍阈值） | 【默认执行】不设硬 P95 / QPS / 灰度窗口数值，按方案兜底 **P0 单点即回滚** |
| 9 | 闭环率判定窗口 N 与目标值 | 【默认执行】不纳入本轮验收（运营指标，非发布门禁） |
| 10 | 仓库外 CI / PR checklist 是否要求 `missingCount=0` | 【默认执行】仓库实测无 i18n 门禁，不新增校验 |
| 11 | 是否额外纳入 MySQL 8.x / PG 最新组合 | **【用户拍板方向】不预设生产库型、三库全测**（SQLite / MySQL 8.x / PG 最新各跑一遍）；详见下方说明 |
| 12 | E2E 工具是否引入 Playwright、CI 是否新增 `ticket-smoke.yml` | 【默认执行】本轮不做（属新增 CI 改动） |
| 13 | 是否顺带修复 `command-menu.tsx` **既有** Admin 项在普通用户命令面板泄露（§1.3 F5） | **【用户拍板】不修既有行为**：本期只门控新增的工单两个入口，让普通用户搜不到 `/ticket-management`，改动面最小 |

> **生产库型说明（用户反问「需要和线上一样吗？」的答复）**：**实现阶段不需要知道线上库型**。两表已按「零 default tag / 零 bool / 零 FK / 零 CHECK / 零 raw SQL、`content` 裸 `type:text`、`autoCreateTime:false`／`autoUpdateTime:false`」设计，同一份代码在 SQLite / MySQL / PG 均可运行。库型只影响**验证与发布阶段**：本地/预发若与线上不同库，可能出现「本地通过、线上才暴露」的差异（MySQL `utf8` 三字节存不了 emoji、SQLite `varchar(200)` 不校验长度需应用层兜底、PG 部分索引禁用）。因本期选三库全测，三种组合都在覆盖范围内，**不阻塞开工**；上线前如在服务器 `.env.prod` 查到 `SQL_DSN` / `SQL_TYPE`，用同库型预发再复测一轮即可，成本很低、**不作为发布门禁**。

**本轮已裁决、不再列为待确认**：U4 不做分页（取最近 200 条）；event 行 `content=""`；64 KiB 计量口径（解码后字符串字节，实现用 `<=65535`）；rune/字节超限统一 `content_too_long`；轮询 I 为构建期常量 30s；`search_by` 不做下拉；详情页轮询不自动标记已读；`closed` 支持 `reopen:true` 一步式重开；`resolved` 可直接回复；**索引保持 3 个、接受 U2 常态 filesort**；**`idx_ticket_admin_notify` 提法作废、本期接受管理员全局 COUNT 全表扫描**；event 行 `actor_role` 存实际触发方；`admin_last_read_id` 为 `tickets` 行级字段。

### 14.2 已知风险（诚实标注，本期不改契约）

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 管理员未读 COUNT 全表扫描 | 大表 + 30s 轮询 | 本期接受；后续评估「冗余标志列 + 离线对账」（§4.3）。**不得**由管理端列表查询顺带计算（见 §5.4），单列索引无效 |
| U2 不带 `status`（常态）时 filesort | 用户列表多一步排序 | 本期接受（单用户工单数有界）；压测不达标再补 `idx_ticket_user_activity` |
| **`keyword` 明文进 `[GIN]` 访问日志** | A1 检索词可见于访问日志 | 运维三条（见 §9）；改 formatter 属全局改动 + 越界，列后续演进；`keyword` 非落库正文，不违反禁令字面 |
| `migrateDBFast()` 无调用点，第二处注册为 dead code | slave 不自建表 | master 优先滚动 + `unread-count` 逐实例主动探测为强制门禁；靠 QA 静态断言防遗漏 |
| 多 master 并发 `migrateDB()` DDL 竞争 | 建表异常 | 所有 worker 显式 `NODE_TYPE=slave`，只留一个 master |
| **CI 无任何 DB 容器 / 测试步骤** | 三库兼容回归无法自动拦截 | C1–C6 在 CI 之外（本地/预发）搭建；书面登记为残留风险 |
| **MySQL 5.7.8 / PG 9.6 最低版本未实测** | 生产若用更老版本可能不兼容 | **【已定，§14.1 #11】三库全测**：SQLite / MySQL 8.x / PG 最新各跑一遍，不预设生产库型；进灰度观测（三库写成功率、慢查询占比） |
| MySQL `utf8`（3 字节）库存不了 emoji | 正文读回不一致 | 三库各跑 emoji 读回用例；`checkMySQLChineseSupport` 是否收紧到 `utf8mb4` 属【后续演进，本期不改】 |
| SQLite `varchar(200)` 不校验长度 | 超长标题可落库 | 应用层 `utf8.RuneCountInString` 是唯一防线，验收需专门验证 |
| 源站 1 周 TTL | 发布后旧页面残留 | 发布/回滚强制 Purge（见 §11.4）+ 四项判据区分缓存与真部署失败 |
| `VERSION` 空 | 版本无法追溯 | 只用 digest / commit sha |
| 轮询间隔 I 运行时不可调 | 故障时无法靠调大 I 降 DB 压力 | 重新发版；容量预案走索引/COUNT 优化，不承诺运行时降级 |
| 标记已读 UPDATE 与 COUNT 之间竞态 | 返回未读数瞬时偏大；并发下已读可能顺带覆盖刚到达的新动态 | 30s 轮询自愈；本期接受 |
| U4 超 200 条无历史分页 | 老消息看不到 | 未来加游标分页 `WHERE ticket_id=? AND id>? ORDER BY id ASC LIMIT ?`，不改水位语义 |
| **多版本分册并存（v1.1/v1.2/v2.0/v3.0/v3.1 + 多份 Delta/深化）** | 实现时误用旧字段口径 | 附录 A 为唯一基线；成员间禁止直连，跨成员信息一律经主理人中转（见附录 B） |

---

## 15. 下一步

本方案为**设计交付物**，不含代码。**§14.1 的 13 项已于 2026-11-06 全部拍板**（限频 5 次/60s、单实例 master、三库全测、命令面板只门控新增项，其余按默认值），参数层已无阻塞。请确认以下之一后推进：

1. **按方案进入实现**（参数已齐，可直接开工；实现后跑 `go build ./...` 与 `bun run typecheck`，**不自动提交 / 推送 / 部署**）；
2. **就某章节提出调整**，我按 v3.1 增量修订本文；
3. **仅归档**，暂不实现。

---

## 附录 A：契约 v3.1 冻结全文（唯一基线）

1. **交付范围**：本轮仅设计，不写实现代码、不提交、不部署。用户四项决策 = 先出方案 / 状态流转 / Admin 分组管理页 / 站内未读角标 + 轮询。
2. **数据模型**：`tickets` + `ticket_messages` 两张表；**不是** `ticket_replies`。字段见 §4.1/§4.2；**严格 3 个索引**（§4.3，接受 U2 常态 filesort）；零 default tag、零 bool 列、零 FK/CHECK/raw SQL；主库 `model.DB`，双注册 `migrateDB()` / `migrateDBFast()`，master 优先发布；`main.go` 不改。
3. **状态机**：四态 `pending/processing/resolved/closed`；建单 `pending`；**删除自动状态联动**；仅「真实状态变更」写独立 `kind='event'` 行（5 条产生路径、6 条不产生路径见 §5.1），event 行 `content=""`、`actor_role` 存实际触发方（`system` 保留枚举不写入）；`resolved` 可追问，仅 `closed` 禁止回复；U6 只收 `action=close|reopen`，A5 收四值 status；`closed` 支持 `reopen:true` 一步式重开并回复；同态空转 no-op。
4. **未读**：四个水位**全部是 `tickets` 行级字段（每工单一行）**；COUNT 公式见 §6.1；按有新动态的工单数；Redis 完全不参与未读；DB 水位唯一真源。**管理员侧全局共享 = 所有管理员共用每工单那一份 `admin_last_read_id`，不是系统单值、也不按管理员分表**；U7/A6 **按工单**标记已读，只消除该工单对应侧未读，角标未必归零。管理员全局 COUNT 本期接受全表扫描，`idx_ticket_admin_notify` 提法作废。
5. **`notify_target`**：用户关闭 = `'none'` 且两个 notify 列均不动（但 `last_message_id`/`message_count`/`last_message_at`/动作方 `user_last_read_id`/`updated_at` 照常推进）→ 管理员未读不增不减；用户重开 = `'admin'` → +1；`'none'` 仅用于用户关闭；管理员所有显式状态变更（含 A5→`closed`）= `'user'`。
6. **API**：13 接口见 §7.2；越权 = 业务 `ticket.not_found` + HTTP 200 + `success:false` + **`data` 键集合全空**；U4 **不分页**，取最近 200 条（`DESC LIMIT 200` + Go 内反转）带 `replies`+`total`+`has_more`，event 计入 200 与 `total`，`message_count` 恒等；`tickets` 无 `content` 列，原正文为 `replies[0]`；未读/标记已读响应字段统一 `count`；写响应不回显正文。
7. **长度**：`title` 1–200 rune；`content` ≤ 8000 rune 且 UTF-8 ≤ 64 KiB（按 Go 解码后字符串 `len([]byte(s))`，实现用 `<=65535`），取先到者；后端 `utf8.RuneCountInString` + `len([]byte(s))`，前端 `[...str].length` + `TextEncoder`，**禁用 JS `String.length`**；controller + service 双重校验、`TrimSpace` 只判空不改写存储值、超限统一 `content_too_long` 不截断。
8. **轮询**：`TICKET_UNREAD_POLL_MS = 30_000` 为**前端构建期常量**；隐藏暂停、可见即拉、失败退避 30→60→120s、失败保持上次角标不清零不闪烁、详情页复用同一常量；仅进入详情时按工单调一次 `/read`，轮询不自动标已读；**I 运行时不可调、调整需重建镜像**。
9. **前端**：Personal `/tickets` + `LifeBuoy` + 角标；Admin `/ticket-management` + `LifeBuoy` + 全局角标；**禁用 `Ticket` 图标/key**；管理端 `beforeLoad` role 校验 → `/403`；系统事件为居中轻量系统提示条，纯系统文案不含用户输入、不渲染 actor、参数化 i18n key，用户侧只显示通用「管理员」；**不做翻页/无限滚动**；i18n 只改 `en.json`+`zh.json`，其余 fallback en，不跑 `i18n:sync`。
10. **安全**：`UserAuth()` / `AdminAuth()`，不接 `authz.RequirePermission`，`SUPER_ADMIN` 无额外特权；归属下推 SQL；日志禁止记录标题/正文/回复；访问日志不记 body/header 但**会记 query**（A1 `keyword` 明文，见 §9）；敏感信息仅前端提示、服务端不检测不打码；本期不接 Turnstile。
11. **限频**：Global → 分组鉴权 → Critical → `TicketWriteRateLimit`（mark `"TW"`、不新增环境变量、所有 duration ≤20min；**数值 5 次/60s，用户 2026-11-06 拍板定值，§14.1 #1**）/ `SearchRateLimit`；U7/A6 不受写限频；60s 原始 content 精确去重；429 无 body 按 HTTP 码判定、**不计入 5xx 错误率**。
12. **发布**：GHCR `latest`；`--no-deps` 更新命令见 §11.2；master 优先、master 侧 `HasTable`/`HasIndex` 只读断言、逐实例带 `New-Api-User` 头探测 `GET /api/ticket/unread-count`（不用 `/api/status`）；发布与回滚均须先 Purge 缓存；版本只用 digest/sha 判断；**三库矩阵在 CI 之外搭**。

> **定稿过程接受的修订（均不改上述 12 条冻结契约）**：① qa Delta R1 对 `admin_last_read_id` 行级语义与「按工单标记已读」的澄清（修正早期「全局共享单值」歧义）；② U4「取最近 200 条」实现手法、越权 `data` 键集合全空、`message_count` 恒等等可断言细化；③ backend 两处自我更正（响应字段统一 `count`、event 行 `actor_role` 存实际触发方）；④ backend 最终口径（访问日志 query 残留、限频数值未定案、`action="generic"`、探测端点带会话）；⑤ data 层技术更正（`idx_ticket_admin_notify` 无效、`content` 禁 default、用户名回填须 `Unscoped()`、GORM 时间戳备选方案 B、master 建表断言、A1 SQL 条数 3 常数）；⑥ 三处裁决（保持 3 索引接受 filesort、`idx_ticket_admin_notify` 提法作废、64 KiB 实现阈值 `<=65535`）。**其余任何「新版本分册 / 勘误单 / 口径回执」一律不再受理。** r2 的唯一动作是把本条第 11 项中原已明确标注「待用户拍板、非冻结定值」的限频数值填为 **5/60s**，属**填空**而非修改冻结契约；其余 11 条一字未动。

---

## 附录 B：分册来源与作废记录

| 分册 | 基线 | 处置 |
| --- | --- | --- |
| 产品 v1.2（scenario-product-manager） | 产品 v1.2 | **采纳**；仅「越权统一 404」措辞按 §7.5 澄清为业务语义 + HTTP 200 信封 |
| 架构 v1.2（system-architect） | 产品 v1.1 / 契约 v2.0 | **骨架采纳**（两表 + `notify_target` + 水位、双注册、master 优先、Gin `/item/:id` 下沉、AdminAuth、归属下推、搜索空 IN 不退化、三库兼容、轮询 C2/C3/C4、CI 无 i18n 门禁）；**作废** 5000 rune/32 KiB、`resolved` 须先重开、自动状态联动 + 合并流条目、500 条上限、统一 404 措辞 |
| 后端 v3.1 + 两处自我更正 + 最终口径（backend-engineer，任务 #4/#9） | **契约 v3.1** | **全文采纳，作为技术权威基线**。定稿后仅接受：响应字段统一 `count`（`unread_count` 作废）、event 行 `actor_role` 存实际触发方。最终口径已并入：`middleware/logger.go` 不记 body/header 但 `gin/logger.go` 会把 `RawQuery` 拼进 `param.Path` 打印（§1.2/§9）、限频数值**在定稿时从未定案**（§14.1，r2 由用户拍板定为 **5/60s**）、`action="generic"`、`unread-count` 探测须带合法会话 + `New-Api-User` 头（§4.4/§11.3） |
| 数据模型初稿（data-engineer，任务 #5） | Phase 1 冻结契约 / v2.0 | **模型章节整体作废**：`ticket_replies` / `reply_count` / `last_reply_id` / `last_reply_role` 二值 / `user_last_read_reply_id` / `admin_last_read_reply_id` / system 事件存 JSON / 5000 rune + 16 KiB / R3「关闭推进 admin 水位」/ R4「不重置水位」/ 自动 `resolved→processing` / 2000 行上限 + 50 条分页 / 本期不做搜索，全部与 v3.1 冲突。其两处勘误与向 backend/qa/devops 扩散的「10 条数据层约束」整篇基于 v2.0，**禁止引用**。**保留采纳**其仓库事实，已并入 §1.2 / §3.3 / §14.2 |
| 数据层深化（data-engineer，任务 #12，对齐 v3.1） | 附录 A（自称不产出第 6 套分册） | **采纳**：GORM tag 级物理设计、三库差异对照、EXPLAIN/N+1 基准、S1–S8 数据流与并发证明、演进回填路径、验收 A1–A19，已并入 §3.3 / §4.3 / §4.4 / §7.6 / §10.1 / §14。**但其残留 3 处旧口径作废**（因其读到的是本文重写前的旧版行号）：event 行 `actor_role='system'`（→ 存实际触发方，§5.3）、`admin_last_read_id`「全局共享单值」（→ `tickets` 行级字段，§4.1/§6.1）、S8「对应侧归零」（→ 按工单消除未读，角标未必归零，§5.2）。其自称「任务 #12」与 §0 交叉引用「§4.5 应为 §4.2」的笔误属分册内部，不影响本方案 |
| 前端（frontend-engineer，任务 #3） | Phase 1 冻结契约（含 9 问） | **契约层整体作废**：`reply_count`、5000 rune、`resolved→processing` 自动流转、500 条上限、`unread` 字段、system 行存 JSON 等均基于 Phase 1 旧模型，章节按附录 A 第 9 条由主理人统一改写；9 问中基于旧模型的部分作废。**仓库实测 6 条经主理人逐条复核后采纳**：`Ticket` 图标 / key 歧义的准确解释并入 §1.1 第 3 条；`keySeparator` 默认 `'.'`、`"Pending"` 已被 8 语占用、全局 `refetchOnWindowFocus:false` 与 `/500` 导航、`command-menu` 未走角色过滤、`URL_TO_CONFIG_MAP` 未映射默认可见，共 5 条并入新增 §1.3，并派生 §8 / §10.1 / §14.1 #13 的实现约束与验收项 |
| 部署 v1.1 + 勘误单（devops-engineer，任务 #8 / #11） | 契约 v2.0 / 架构 v1.2 | **部署/发布/运维主体采纳**；核实出的 `VERSION` 空、`cache.go` 一周 TTL、`FRONTEND_BASE_URL` 301、CI 六 workflow 无 DB/无测试步骤并入 §1.2 / §11.4 / §14.2；限频 `"TW"` 前缀与不新增环境变量、429 不计 5xx 并入 §7.6 / §11.5。**作废**：6.3a 5000 rune/32 KiB、6.3b `reopen:'if_resolved'`、6.3c 自动流转与合并流条目、越权 404、500 条上限等按架构 v1.2 旧口径的条目；「故障时调大 I 降 DB 压力」按附录 A 第 8 条降级为「需重新发版」 |
| 测试 v3.0 + Delta R1（qa-engineer，任务 #7 / #10） | 契约 v3.0 自称最终冻结 / v3.1 增补 | **用例骨架采纳**（编号留在分册归档，方案只收契约层要点）。Delta R1 的 U4 不分页最近 200 条、越权 `data` 键集合全空、`message_count` 恒等、A4 `status==当前` 不写 event、A5→`closed` 用 `'user'`、错误码矩阵、429 不计 5xx、CI 无 DB 容器、四项部署判据均已并入 §4–§14。**其最有价值的一处是澄清 `admin_last_read_id` 为 `tickets` 行级字段、A6 按工单标记已读**，据此修正了早期「全局共享单值」的歧义表述（§4.1 / §6.1 / 附录 A 第 4 条） |

> **协作约束（根因复盘）**：本轮共 **6 例成员间直连对齐口径**，导致 v1.1 / v1.2 / v2.0 / v3.0 / v3.1 多套契约并存；广播收口后仍有 qa Delta R1、backend 最终口径、data 层深化、前端最终分册等 **4 条在途消息**到达。**所有跨成员技术信息一律经主理人中转，成员之间不得直连**；本文附录 A 为唯一有效基线，此后不再产出新版本分册。汇编权与最终裁决权在主理人。**契约层为终稿，不再修订**；r1 仅补录经复核的事实层与实现约束，r2 仅按用户拍板填充 §14.1 参数并将限频数值 10→5 同步到 §7.6 / §10.1 / 附录 A 第 11 条 / 本附录，附录 A 其余 11 条一字未改。
