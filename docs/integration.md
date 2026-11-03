# 已完成的后端 / AI 集成契约

最新全栈合并记录见 [fullstack-integration.md](fullstack-integration.md)。网站首页为 `/#/discover`，原生聊天页为 `/#/assistant`，独立双语演示页为 `/assistant`。

当前入口：`main.py` 按 `DATA_SOURCE` 选择完整后端或独立模拟应用。`cinema.create_app()` 创建主应用时注册 `cinema_ai.init_app()`；不启动第二个 HTTP 服务，不需要跨域代理。测试/初始化可传 `ENABLE_AI=False` 禁用 AI 注册。

## 服务调用与数据边界

```text
POST /api/assistant/chat（兼容 /api/ai/chat）
  → ChatInput / CSRF 校验 → 当前服务端会话
  → AgentService → DeepSeek 直接回复或发起原生 Tool Calls
  → Pydantic 参数校验 / 工具白名单 / 当前登录身份 / 条件合并
  → BusinessTools → BackendCatalog / cinema.catalog / cinema.assistant_reads
  → 后端组装事实与卡片 → 模型按需继续查询或组织回答 → JSON

GET /api/catalog/screenings → 同一个 BackendCatalog
GET /api/screenings 与 POST /api/assistant/recommendations → 同一个 cinema.catalog.search
GET /api/catalog/screenings/<id> → cinema.catalog.seatmap → 最新预览
PATCH /api/ai/preferences → 校验并更新手动选择的条件，不调用模型
POST /api/ai/recovery → 校验会话绑定的恢复选项，更新用户选择的条件后重新查询，不调用模型
```

`cinema_ai/backend.py` 只读影片、影院、区域、场次、票价、布局和座位状态。交易接口保持队友后端的权限、CSRF、幂等和事务逻辑；聊天接口不接受模型 SQL、模型 URL、客户端角色历史或用户 ID，不调用占座/购票/改签方法。模型调用期间不持有数据库连接或行锁；stub 所需的公开片名/影院名称在请求线程读取，再作为纯数据快照进入工作线程。

2026-10-24 已升级为业务 Agent。新增电影筛选、预算和候选引用；`cinema/assistant_reads.py` 以登录会话限定本人订单/优惠券/改签资格和费用预览，金额计算复用 `booking.price_selection`。个人明细不作为模型工具结果发送。详细工具契约及当前限制见 [business-agent.md](business-agent.md)。

完整后端和 AI 共用 `SECRET_KEY`、Flask Cookie、`session['csrf']`。登录/退出会轮换或清理 Cookie 会话，同时使旧 AI 会话不可访问；内存中的旧记录按闲置期限清理。

## 接口与响应格式

**在 backend 模式下，成功响应统一为 `{ "data": ... }`，HTTP 错误为 `{ "error": { "code", "message", ... } }`。所有数据库 ID 都是十进制字符串，前端禁止转为 JavaScript Number。** 独立 mock 模式保留原 AI 的平铺 JSON 和小整数 ID，演示前端兼容两种格式。

| 接口 | 行为 |
| --- | --- |
| `GET /api/ai/session` | 获取/建立 AI 会话，返回 `csrf_token, filters, conditions, task, provider, data_source, districts, films, today` |
| `GET /api/auth/csrf` | 原后端 CSRF 入口；返回的 token 与 AI 当前会话使用的 token 相同 |
| `POST /api/assistant/chat` | 原占位接口已实现，正式聊天入口 |
| `POST /api/ai/chat` | 相同实现的兼容路径 |
| `DELETE /api/ai/session` | 清空本会话筛选和最近对话，不退出登录 |
| `POST /api/ai/recovery` | 接收 `token, option_id, locale`；需要 CSRF，重查之前校验当前条件快照 |
| `GET /api/catalog/screenings` | AI 页普通筛选，最多 3 张卡片；不改变聊天条件 |
| `GET /api/catalog/screenings/<id>` | 每次实时读取，包含不可售状态，不锁座 |
| `GET /api/screenings` | 原分页查询及原字段契约保持兼容 |
| `POST /api/assistant/recommendations` | 原结构化推荐入口保持确定性排序；不调用模型 |

浏览器先 GET 初始化接口，保留 Cookie，写操作发送 `X-CSRF-Token`。登录后使用登录响应里的新 token，或重新初始化。403 后前端重新获取 token，并提示错误，不自动重放消息或交易。

聊天请求只允许以下两个字段，正文最多 16 KiB，消息最多 2,000 字符：

```json
{"message":"明天朝阳区三个人看电影，尽量坐中间","locale":"zh"}
```

响应 `data` 包含：

```json
{
  "status": "ok",
  "reply": "已按整组连座、偏好分区和开场时间排序。以下均为参考方案，尚未占座；点击后将重新检查座位和价格。",
  "locale": "zh",
  "intent": "recommend",
  "filters": {
    "city": "beijing", "district": "chaoyang", "film_query": null,
    "date": "2026-10-24", "time_start": null, "time_end": null,
    "party_size": 3, "hall_type": null, "zone": "middle"
  },
  "cards": [], "films": [], "cinemas": [], "rules": [],
  "provider": "stub", "data_source": "backend", "error_code": null
}
```

这里省略卡片内容，示例日期需换成当前可售日期。`status` 为 `ok / needs_clarification / unavailable`；模型不可用是 HTTP 200 的业务降级响应，不丢失已确认条件。HTTP 400 是输入无效、403 是 CSRF 无效、409 是同会话忙、503 可表示数据库不可用。模型错误代码包括 `missing_key / authentication / quota / rate_limit / timeout / network / upstream / busy / invalid_output`。解释超时的成功查询会保留卡片并附 `explanation_fallback=true`。

## 枚举、时间和布局映射

| AI 字段 | v1 数据来源 / 处理 |
| --- | --- |
| `district=chaoyang` 等拼音 | 通过 districts.admin_code（如 110105）找数据库 ID；不依赖随机 ID 或英文显示名。数据库无该区域时返回空结果 |
| `film_query` | 用公开片名匹配，多个匹配先追问，再传唯一 film_id 给查询；不接受模型生成 ID |
| `hall_type=standard / imax / dolby` | `STANDARD / IMAX / DOLBY_CINEMA` |
| `zone=front / middle / back` | `FRONT / MIDDLE / REAR` |
| `party_size` | 统一 1–12，与占座接口相同；AI 缺少人数先追问，普通筛选默认 1 |
| `date` | 北京时间自然日；默认今天，只查询尚未开场的 PUBLISHED 场次及启用的影院 |
| `time_start / time_end` | 起点包含、终点不包含；24:00 仅作结束值。原 `/api/screenings` 的 start_to 继续包含终点 |
| 数据库 DATETIME | v1 无时区北京时间；适配输出带 `+08:00` 的 ISO 字符串，与后端可注入 CLOCK 保持一致 |
| 座位相邻 | 直接使用 choose_seats 的 `row_no + aisle_segment + segment_position`，座号不必连续，不跨过道 |
| 前/中/后区 | 直接使用 v1 最大余数 30%/40%/30% 算法：10 排 3/4/3，12 排 4/5/3 |
| 座位图 | 使用 map_x/map_y 和布局的 TOP/BOTTOM/LEFT/RIGHT 银幕方向，不从座号推断物理位置 |
| 售出 / 占座 | SOLD 不可选；HELD 只有 ACTIVE 且 expires_at > now 才不可选；预览不暴露 hold_owner_id |
| 价格 | STANDARD → regular，STUDENT → student；整数分，参考单价，不含券，不是最终付款金额 |
| 评分 | 初始总分/人数与用户评分合并后的 10 分制加权均值；无初始或用户评分时为 null/0 |
| 片名/简介/影院地址 | v1 无中英双字段，两个界面均显示数据库原文，不虚构译名；UI 和规则支持中英切换 |

`cinema.catalog.search` 增加了仅供内部适配使用的关键字参数 `end_exclusive=True`。排除终点发生在数据库过滤和分页之前，因此不会因过滤掉前三项而漏掉后面的符合场次；原 HTTP 参数和默认行为保持不变。

## 推荐卡片和最新预览

卡片字段：

- `screening_id`：十进制字符串。
- `film`：`id, title, synopsis, duration_minutes, rating, rating_count`。
- `cinema`：`id, name, district, address`。
- `starts_at, hall_type, hall_label`：北京时间及厅型。
- `suggested_seats`：`id, row, number, segment, segment_position, map_x, map_y, zone, label`。
- `contiguous, preferred_zone_count, unmet_preferences`：排序解释事实，未满足项可为 `split_seats / preferred_zone`。
- `fares`：`{regular: 整数分, student: 整数分}`；`currency=CNY`，`price_basis=per_ticket_before_coupons`。
- `reserved=false, checked_at, version`：不占座，查询时间，场次 revision_no。

预览额外包含 `status, saleable, seats, layout`；每个座位有 `available / sold / held` 状态。建议座位消失或已不可选、票价变化、场次取消/开场/影院停用都会在页面提示。不存在的场次返回 404。

原生前端 `cinema/static/js/assistant.js` 的 `recommendationLink(card)` 已将后端场次 ID 和建议座位 ID 带入 `/#/seats/<id>?party_size=...&seat_ids=...&from=assistant`。选座页重新查询库存，只预选仍可用座位；建议失效时提示重选，不自动占座。独立演示页的只读预览也提供该入口。后续登录、确认占座、票种、报价和结算使用原后端流程。

## 导入与原项目差异

源压缩包：`cinema-backend-v1.zip`，SHA-256：

```text
0d210e747b2db4584da780096723d179726ac2c23d9053a35e3011bab645e100
```

- `cinema/` 导入原业务代码；`__init__.py` 加 AI 配置和注册，保留 AI 页面需要的 CSP。
- `api.py` 原聊天 503 占位改由 AI Blueprint 提供；结构化推荐说明更新，排序仍不依赖模型。
- `catalog.py` 增加内部独占结束时间选项；原默认行为不变。
- 原 `sql/001_initial.sql` 移至 `cinema/sql/001_initial.sql`，DDL 内容不变，`cli.py` 使用包资源读取，支持安装后运行。
- 原测试放入 `backend_tests/`，fixture 增加模型线程池释放；新增 `test_ai_bridge.py`。
- `scripts/local_mysql.py` 自动配置 backend/stub，初始化期间不注册 AI；原空库保护和 socket 隔离保留。
- 原 README、API、验证记录、依赖清单保存在 `docs/backend-v1/`，仅作为未修改的历史交接材料。**其中“AI 未接入”和旧文件位置等描述不代表当前实现。**
- 当前依赖和启动方式以根 README、pyproject.toml 和 requirements.lock 为准。

规则说明位于 `cinema_ai/data/rules.json`，版本 `2026-10-24.10-point`，补充了本站评分规则。已经同步每组最多 12 人、每顾客一组有效占座，以及影院取消时退当前实付票款和整条改签链累计手续费。规则说明不是收费执行器；未来改动 booking/management 业务时需一起更新并做回归。

## 验收与待完成项

业务 Agent 升级后的最新验证见 [business-agent.md](business-agent.md)：完整隔离库回归 171 项 Python 测试、5 项 AI 前端链接测试通过，7 组真实 DeepSeek 样例通过业务断言，其中一组解释按设计降级为后端模板。以下为升级前的历史记录。

本机 MySQL 8.4.4 完整回归 124 项 Python 测试及 4 项前端跳转测试通过，不依赖历史交接包报告。浏览器在随机测试库实测了推荐到模拟付款、个人中心查看订单的闭环。2026-10-24 另外使用真实 DeepSeek 与当前 MySQL 演示库，验证自然语言推荐、多轮人数修改保留其他条件及学生票规则问答，均通过且未出现解释降级；本次配置更新未重复运行完整回归。

本地 DeepSeek 已配置，其他开发者需自行填写本机 `.env`，密钥不随源码交接。正式选座、个人中心和管理前端已从最新包接入。无需再开发 MySQL AI 适配层。内存会话和限流适用于单进程演示；部署多 worker 前替换共享存储和锁。


## 统一 10 分制评分（2026-10-24）

当前所有页面及 AI 只提供一个评分。原参考分和人数已迁为 `film_rating_baselines` 初始评分，旧 `film_reference_ratings` 表在备份并成功迁移后删除；接口不再返回 `reference_rating`。用户评分保留 `ratings.stars` 和请求字段 `stars` 以兼容原接口，但值域变为整数 1–10，数据库约束、后端校验、详情评分表单和 AI `min_rating` 上限均为 10。模型不默认生成高分门槛，明确的“至少 8 分”才作为硬限制。

`cinema/ratings.py` 统一汇总：首页、详情、普通场次与 AI 均读取 `rating={average,count,scale:10}`；AI 影片对象增加 `rating_scale:10`。计算公式为 `(初始均分 × 初始人数 + 所有用户当前评分之和) / (初始人数 + 有效用户评分数)`，四舍五入到一位小数。同一顾客修改评分时只更新原票，人数不增加。初始数据不会生成虚构的顾客账号或逐条评价。

旧库升级：停止网站后运行 `.venv/bin/python scripts/migrate_ratings.py --apply`（省略 `--apply` 仅预览）。脚本限定当前项目本地 `cinema_demo`，在 `instance/rating-migration` 写入权限 0600 的原始评分及建表语句备份。既有 1–5 星用户评分乘 2；转换、初始分迁入和版本标记一起提交，重复运行不会再次乘 2。DDL 与数据事务分阶段执行，支持中断后重试，旧表在数据提交后才删除。新数据库使用 `init-db`，直接初始化 10 分制，无需转换。运行账户保持原权限，DDL 仅由项目本地管理连接执行。

本次演示库迁入 5 部影片的初始分：Resident Evil (2026) 7.3、牛来 (Niu Lai) 6.0、Tenzing 7.7、The Love Hypothesis 6.6、The Shawshank Redemption 9.7；原顾客评分为 0 条。以后数据可能随用户评分变化，展示以实时查询为准。导入清单使用 `rating_seed`，重新导入不会恢复旧的独立参考分字段。
