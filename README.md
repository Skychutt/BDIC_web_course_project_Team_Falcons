# Falcons Cinema：完整网站与 AI 助手

已合并队友最新的 cinema-fullstack-v1 前后端，并接入现有 AI 助手。网站包含选片、选座、模拟付款、个人中心和角色管理页面；右下角悬浮助手支持中英文聊天、多轮条件、规则问答和推荐后进入正式选座。已有演示库需要执行影评社区迁移和评分快照导入。这两步只新增社区表和来源快照，不改写已有订单或顾客评分。

首页已更新为电影优先的票务布局：原创影片主视觉、数据库片单、AI 推荐入口、影院和场次筛选，使用白底与玫红强调色。`cinema/static/ticketing.css` 管理主题，`cinema/static/js/catalogue.js` 渲染片单；单部电影采用横向卡片，多部电影自动排列。当前只展示数据库中的实际影片和评分，主站仍为英文，AI 保留中英双语。 评分统一为 10 分制，初始评分和顾客后续评分共同计算；首页、详情与 AI 使用同一评分，迁移与接口说明见 [集成契约](docs/integration.md#统一-10-分制评分2026-10-24)。

**当前工作区已安装依赖、初始化独立 MySQL 8.4.4 演示库，并于 2026-10-24 接通真实 DeepSeek，完成少量真实接口联调。** 数据来自数据库里的虚构演示影院，不代表真实影院营业数据。密钥仅保存在被 Git 忽略的本地 `.env` 中，不随项目交接。

## 占座与付款结果

每组座位最多保留五分钟，最晚到开场。服务器取得座位和钱包的锁后，用同一个结算时间核对截止时间并记录付款。按时结算的订单一次提交扣款、出票、座位归属和回执。即使网页稍后才收到结果，座位仍归原买家。若等锁期间已经到期，交易回滚，钱包和优惠券均可继续使用。

付款响应中断时，选座页会自动查询原占座的回执，刷新后也可以继续查询。查询本身只读。服务器确认占座仍有效且尚无回执时，用户可以手动重试同一笔付款。已出票的订单可在 **My tickets** 查看。

## 电子影票

在 **My tickets → View ticket** 打开带海报、观影标语、影院、时间、座位和购票人姓名的电子票，点击 **Save ticket image** 保存高清 PNG。海报复用本地影片资源，标语是本站原创文案；无匹配海报时使用通用插画。

二维码打开签名影票链接，登录后仅订单本人或该影院员工可查看，每次打开都会读取最新状态；退票、改签、影院取消和场次结束会显示相应状态。当前提供影票识别和查询，不会执行入场核销。图片是保存时的快照，以二维码查询到的状态为准。

本次无数据库迁移。更新后运行 `python -m pip install -r requirements.lock` 安装新增的 Segno 二维码库，再重启 `main.py`。二维码使用生成时的网站地址；如果从 `127.0.0.1` 打开网站，手机无法访问该电脑的本地地址，跨设备扫码需使用可访问的局域网或部署地址生成影票。

接口测试：`pytest backend_tests/test_ticket_cards.py`（需显式设置 `TEST_DATABASE_URL`）。浏览器测试：启动隔离的 `scripts/browser_fixture.py` 后运行 `npm run check:ticket`；本机 Chrome 可设置 `CINEMA_QA_CHROME=1`。测试只在隔离库购票与退票，不操作日常使用的数据库。

## 用户退票

在 **My tickets → Refund tickets** 预览并确认整单退票。退款进入模拟钱包，原票失效，全部座位恢复可选。提前 12 小时免费，6–12 小时收 5%，30 分钟–6 小时收 20%，不足 30 分钟不可退；已收改签费不退。

**已有数据库先升级：** `python -m flask --app cinema:create_app migrate-customer-refunds`，然后重启 `main.py`。命令可重复运行并保留已有数据；新建空库已自动包含升级。详见 [退票规则、升级和测试](docs/customer-refunds.md)。

## 影评与讨论

顶部 **Reviews** 是独立影评入口。电影详情中的 **Reviews & discussions** 可进入该片的五星评分、短评和讨论区。顾客无需购票即可评分，影评页、购票页和 AI 推荐共用一个十分制综合分。

有豆瓣快照时，综合分等于（快照均分 × 快照票数 + 本站评分总和）÷ 总票数，显示到小数点后一位。评分卡附有快照来源和核验日期。星级分布结合快照公布的百分比和本站实际票数，因此是近似值。没有快照的影片沿用已有的初始评分和票数；初始数据缺少星级分布时，页面用横线表示。没有导入数据时，只统计本站投票。

演示时可以在影评页给一部有快照的影片打分。首次评分后总票数增加一票，修改自己的评分时总票数不变。快照票数很大时，新增一票后显示的均分可能仍相同。

已有数据库先执行 `.venv/bin/python -m flask --app cinema:create_app migrate-community`，再执行 `.venv/bin/python -m flask --app cinema:create_app import-rating-snapshots data/film-rating-snapshots-20261114.json`，最后重启网站。两个命令只新增社区表和来源快照，不改写顾客评分或订单。功能、数据来源和测试说明见 [影评与讨论](docs/film-community.md)。

## 现在启动

在项目根目录运行（Python 3.11+）：

```bash
.venv/bin/python scripts/local_mysql.py status
# 若显示未运行，先执行：
.venv/bin/python scripts/local_mysql.py start
.venv/bin/python main.py
```

打开 <http://127.0.0.1:5001>，使用顾客账号登录后，点击右下角 **AI 悬浮球** 即可聊天。切换影片、影院和选座页时会保留对话与输入草稿；点击推荐卡片会收起面板并进入对应页面。顾客打开旧链接 <http://127.0.0.1:5001/#/assistant> 会在首页展开助手。原来的双语演示页保留在 `/assistant`，其中预览也可进入正式选座。网站其余界面沿用队友的英文设计。MySQL 仅监听项目内 Unix socket。默认使用 5001，避免与 macOS Control Center 占用的 5000 冲突；运行网站的终端需保持开启。

可以依次输入：

1. `明天三个人看电影，尽量坐中间`
2. `改成两个人，其他不变`
3. `朝阳区，IMAX`（没有符合场次时会返回空结果，不自动换厅）
4. `不限区域，不限厅型`
5. `《Journey Beyond the City》讲了什么？`
6. `学生票有什么要求？` / `影院取消会退哪些费用？`

空库执行 `flask --app cinema seed-demo` 时，仍只写入测试用的 1 部影片、3 家影院和 9 场放映。课程演示目录要先导入原有片单和六家影院，再运行 `scripts/expand_demo_catalogue.py --apply`，得到 10 部影片和 9 家北京影院。场次在导入时生成，不会自动滚动；过期后可用员工 Cinema workspace 或原管理 API 新增场次。首页会列出未来有排期的日期。`DATA_SOURCE=mock` 的独立模拟模式则每日滚动生成未来场次。

本地演示账号密码保存在 `instance/DEMO-ACCOUNTS.txt`，数据库连接和签名密钥在 `.env`，均被 Git 忽略。无需登录即可使用公开 AI 查询；已有登录、占座、订单、改签、退款等 API 仍由队友后端处理。完整网站已可购票及管理，AI 本身不执行交易。此次附带的 DEMO-ACCOUNTS.txt 属于队友的数据库，密码与本地不同；本地登录请使用项目 instance/DEMO-ACCOUNTS.txt，未覆盖本地密码。

停止网页服务用 Ctrl+C；停止私有数据库：

```bash
.venv/bin/python scripts/local_mysql.py stop
```

## 新顾客邮箱注册

新顾客在注册页填写邮箱、获取六位验证码，并提交姓名、密码和验证码。验证成功后网站自动登录并一次性发放 ¥1,000 演示余额。后续登录及已有账号继续使用邮箱和密码。

注册与柜台售票共用下方的 SMTP 配置。每个注册验证码有效 5 分钟，最多可输错 5 次；重发后上一封失效。每个邮箱至少间隔 60 秒，每滚动小时最多发送 5 次，同一来源 IP 最多发送 20 次。

已有数据库先用具备建表权限的账号运行 `flask --app cinema:create_app migrate-registration-email`，然后重启网站。全新数据库初始化时会自动建表。

前端先向 `POST /api/auth/register/code` 提交 `email`，取得 `challenge_id`。再向 `POST /api/auth/register` 提交 `email`、`display_name`、`password`、`challenge_id` 和六位字符串 `code`。两次请求均携带当前 CSRF 令牌，完成注册还需 `Idempotency-Key`。成功响应包含用户、演示余额和登录后的新 CSRF 令牌。

## 门店工作台与柜台售票

店长和店员登录后直接进入本店排片。办理柜台售票时，员工选择本店场次、座位和票种，填写顾客的注册邮箱。邮件写明场次、座位和本次余额变动金额。顾客同意后出示六位验证码，员工输入后出票。验证码最长有效五分钟，座位与价格在出票时复核。柜台也支持本店优惠券和原订单改签。

已有数据库用具备建表权限的账号执行 `flask --app cinema:create_app migrate-counter-email`。项目的私有 MySQL 也可以在根目录运行 `mysql --no-defaults --socket="$PWD/instance/mysql/mysql.sock" -uroot cinema_demo < cinema/sql/007_counter_email.sql`。新建数据库会自动包含验证码表。

每位队友首次运行时，通过团队的私密渠道获取只包含 `SMTP_*` 配置的 `.env.smtp`，放在项目根目录（与 `main.py` 同级），然后重启 Flask。这份文件已被 Git 忽略，之后拉取更新可继续使用。系统环境变量或原有 `.env` 已设置非空 `SMTP_HOST` 时，网站沿用那一套发件配置。

自行配置时，所需字段见 `.env.example` 的 SMTP 部分。QQ 邮箱使用 `smtp.qq.com`、端口 `465`、`SMTP_SECURITY=ssl`，发件地址和用户名都填完整 QQ 邮箱，密码字段填 SMTP 授权码。顾客需使用可以收信的注册邮箱获取验证码。

## 配置 DeepSeek

**编辑现有 `.env`，不要用示例文件覆盖已经生成的数据库连接和 SECRET_KEY。** 修改：

```dotenv
DATA_SOURCE=backend
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=在本地填写你的密钥
DEEPSEEK_MODEL=deepseek-flash
AI_TIMEOUT_SECONDS=30
```

重启应用。请求仅从后端发往 `https://api.deepseek.com`，使用 OpenAI 兼容 SDK 与原生 Tool Calls，关闭思考模式、流式输出和自动重试。每轮最多 4 次模型请求、6 次只读工具调用，默认共用 30 秒预算，`AI_TIMEOUT_SECONDS` 可调整但不能超过 60 秒；重复调用提前停止。接口依据 [DeepSeek Tool Calls 文档](https://api-docs.deepseek.com/guides/tool_calls/)。密钥不会发送到浏览器。

观影助手仅限登录的顾客使用，支持影片讨论、选片与购票服务。游客点击悬浮球会看到顾客登录提示。员工、店长和平台管理员登录后，悬浮球和首页助手卡片均隐藏，访问助手书签会进入工作台。完整、明确的“我的订单／我的优惠券”直接查询本人数据并使用固定说明，即使模型不可用也能查询；复杂的业务问题仍由模型选择只读工具。选片无需人数，场次推荐再检查整组座位；还支持类型、本站评分、预算、候选序号及改签资格/费用预览。Python 校验参数、身份与硬条件，卡片和金额由后端生成。个人明细保留在后端和浏览器，模型只获得查询状态及候选序号。解释超时或事实校验失败时使用已验证结果的模板。`AI_PROVIDER=stub` 只支持有限的离线固定表达；仅填写密钥不会自动启用 DeepSeek。完整说明与限制见 [业务 Agent 集成说明](docs/business-agent.md)。

| 配置 | 说明 |
| --- | --- |
| `DATA_SOURCE=backend` | 通过 `cinema.create_app` 启动完整后端和 AI；必须配置 MySQL 与稳定随机 SECRET_KEY |
| `DATA_SOURCE=mock` | 独立演示可浏览模拟目录；聊天需要提供登录身份的宿主应用 |
| `AI_PROVIDER` | `stub` / `deepseek`，独立于数据来源 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-flash` |
| `AI_TIMEOUT_SECONDS` | 大于 0、至多 60 秒；默认 30 秒 |
| `AI_MESSAGES_PER_MINUTE` / `AI_MESSAGES_PER_DAY` | 每个账号默认 6 条/滚动分钟、50 条/北京时间自然日 |
| `AI_IP_ALERT_PER_MINUTE` | 同一来源一分钟内默认 60 条已接收消息时记录告警，共享网络用户各自计数 |
| `DATABASE_URL` | SQLAlchemy `mysql+pymysql` URL，仅 backend 模式需要 |
| `SECRET_KEY` | 后端要求至少 32 个随机字符；私有初始化脚本自动生成 |
| `COOKIE_SECURE` | 完整后端默认 false；HTTPS 部署设 true |
| `HOST` / `PORT` | 默认 `127.0.0.1` / `5001` |

单独试模拟模式，无需改动现有 `.env`：

```bash
DATA_SOURCE=mock AI_PROVIDER=stub .venv/bin/python main.py
```

## 在另一台电脑安装

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install --no-deps .
```

无数据库演示：复制 `.env.example` 为 `.env` 后运行 `python main.py`。

使用本地独立 MySQL（先安装 MySQL 8.4，并让 `mysql`、`mysqld`、`mysqladmin` 在 PATH 中）：**不要先创建 `.env`**，运行 `python scripts/local_mysql.py init`，然后 `python main.py`。初始化脚本拒绝覆盖已有 `.env` 或 `instance/mysql`。`local_mysql.py` 使用 Unix socket，只适用于 macOS／Linux。

## Windows 干净环境

不要在 Windows 上运行 `scripts/local_mysql.py`。使用自己安装的 MySQL 8.4：

1. 复制 `.env.example` 为 `.env`，填写自己的 `DATABASE_URL` 和至少 32 个字符的 `SECRET_KEY`，保留 `DATA_SOURCE=backend`。
2. 只对空库执行 `python -m flask --app cinema:create_app init-db`。然后按 `docs/film-programme.md` 和 `docs/cinema-directory.md` 导入原有片单和六家影院。
3. 已有库不要重新初始化或 seed。在项目根目录依次执行：
   `python -m flask --app cinema:create_app migrate-customer-refunds`
   `python -m flask --app cinema:create_app migrate-community`
   `python -m flask --app cinema:create_app import-rating-snapshots data/film-rating-snapshots-20261114.json`
   `python scripts/expand_demo_catalogue.py`
   确认预览后再执行 `python scripts/expand_demo_catalogue.py --apply --days 14`
4. 运行 `python main.py`，打开 http://127.0.0.1:5001 。本地演示需要清理过期占座和影院取消退款时，另开终端运行 `python scripts/worker.py`（或按需执行 `python -m flask --app cinema:create_app expire-holds` / `process-refunds`）。

连接队友提供的服务器：编辑 `.env` 为 `DATA_SOURCE=backend` 并设置 `DATABASE_URL`、`SECRET_KEY`。已有 v1 schema 可直接使用；仅在明确的**空数据库**上执行 `flask --app cinema init-db`。DDL 在 `cinema/sql/001_initial.sql`，非空库会拒绝初始化。不要对已有库重新 seed。已有库补齐影评、评分快照和新增样本时，使用上面的 Windows 第 3 步，不要重新初始化。

Windows 上运行完整数据库测试时，使用有权创建和删除测试库的专用 MySQL 账号，不要把生产账号写进仓库：

```powershell
$env:TEST_DATABASE_URL = "mysql+pymysql://test_user:本机密码@127.0.0.1:3306/mysql"
python -m pytest backend_tests -q
Remove-Item Env:TEST_DATABASE_URL
```

测试只创建并删除随机命名的 `cinema_test_*` 数据库；未设置 `TEST_DATABASE_URL` 时相关测试会跳过。

## 验证

业务 Agent 升级的最新验证与限制见 [business-agent.md](docs/business-agent.md)：完整隔离库回归 171 项 Python 测试、5 项 AI 前端链接测试通过；另有 7 组真实模型业务样例。下方 124 项为此前全栈合并阶段的历史记录。

```bash
# AI 单元测试，无密钥、无 MySQL
.venv/bin/python -m pytest tests -q

# 私有 MySQL 实例上的完整回归；随机创建/删除测试库，不动演示库
.venv/bin/python scripts/test_mysql.py -q
```

已在 MySQL 8.4.4 上通过 **124 项 Python 测试**：64 项 AI 测试、53 项最新全栈后端/页面测试、7 项 AI 联调测试。另有 **4 项前端跳转测试**通过（`npm run check:assistant`，只需 Node，不需安装浏览器）。联调覆盖共享排序、字符串 ID、多轮继承、双语一致性、CSRF 与登录轮换、会话隔离、人数上限、实时占座/过期/已售/取消/票价更新、模型降级及只读边界。浏览器已在随机隔离库验证中英文聊天、三人改两人、推荐进入选座、登录后保留选择、占座、服务端报价、模拟付款、个人中心确认订单，以及旧建议座位售出后的提示。未重新执行队友全部 42 组浏览器套件，原报告保存在 docs/fullstack-v1；本轮实际验证见 docs/fullstack-integration.md。

`pytest` 未设置 `TEST_DATABASE_URL` 时会跳过数据库测试；跳过不算数据库验证。自动化测试默认使用模型替身。2026-10-24 单独完成真实 DeepSeek＋MySQL 联调：自然语言推荐、三人改两人且保留其他条件、学生票规则问答均通过；未触发占座或订单操作。这些少量样例不代表模型的全面评测。其他开发者仍需在自己的 `.env` 填写密钥并重启应用。

## 项目结构与协作

高德地图与浏览器定位已接入完整网站的 `#/cinemas` 页面，配置、隐私边界、影院坐标录入及验证记录见 [地图接入说明](docs/amap-integration.md)。当前演示目录中的 9 家北京影院已有 GCJ-02 坐标，可以显示标记。没有坐标的影院仍可按行政区筛选，但不能计算距离或规划路线。

```text
cinema/                  队友后端：鉴权、查询、占座、订单、改签、管理、退款
  sql/001_initial.sql    原 v1 DDL（随 Python 包分发）
  frontend_api.py         页面组合查询
  web.py, templates/     完整网站 Jinja 入口
  static/js/assistant.js 原生网站内的 AI 对话与选座跳转
  static/js/assistant-widget.js 全站悬浮助手、跨页面状态及登录切换清理
  static/assistant-widget.css 桌面聊天面板与手机适配
cinema_ai/
  backend.py             v1 只读服务适配、时间/枚举转换与卡片组装
  catalog.py             独立模拟模式目录服务
  providers.py           DeepSeek 与离线替身
  conversation.py        服务端会话、结构化条件和问答
  routes.py              AI/目录接口、主站 CSRF 与响应格式
  data/rules.json        双语规则说明，已同步累计改签费退款
  templates/, static/    Jinja + 原生 JS/CSS 演示页
scripts/local_mysql.py   私有本地 MySQL 初始化/启停
scripts/test_mysql.py    完整回归入口
scripts/worker.py        队友的占座清理、退款工作进程
backend_tests/           原后端测试与新增 AI 联调测试
tests/                   独立 AI 测试
docs/integration.md      当前集成契约与差异
docs/backend-v1/        第一版交接文档快照
docs/fullstack-v1/      最新全栈交接文档快照
docs/fullstack-integration.md 本轮合并与验证记录
```

单进程内存会话保留最近 8 轮，闲置 30 分钟清理；每条消息最多 2,000 字符，每组 1–12 人，每次最多 3 张推荐卡片。推荐卡片已接入正式选座页，只预选仍可售的建议座位；登录和明确确认后才能占座，报价和付款继续由原后端控制。

后台清理/退款由 `python scripts/worker.py` 执行。正式部署需要 HTTPS、安全 Cookie，以及跨 worker 的共享 AI 会话和限流；当前适用于课程开发和本地单进程演示。

三类影厅现采用不同的座位布局；旧数据库升级及组员同步方式见 [影厅座位布局](docs/seat-layouts.md)。
