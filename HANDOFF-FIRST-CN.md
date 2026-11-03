# 队友请先阅读（2026-10-24）

这是当前工作区的完整代码快照，包括未提交的开发代码，Flask 后端、原生 JavaScript/CSS 前端、AI 助手、高德地图、海报、测试、依赖锁定文件和数据库脚本。

## 配置已包含

根目录隐藏文件 `.env` 已包含当前 DeepSeek API Key、高德 JS Key、安全密钥，以及本机数据库连接和 Flask 签名配置。按项目所有者的明确要求一起交接，请仅限团队私下使用。压缩包未加密，不要公开上传；使用共享 DeepSeek Key 会消耗同一账号额度。本文和清单不展示密钥原文。

`.env` 内的数据库地址包含原电脑的本地 socket 路径，不能在另一台电脑直接使用。下面的新电脑步骤会生成自己的数据库连接和 SECRET_KEY，同时保留共享的 AI／地图配置。

## 当前功能与演示数据

- 5 部影片：Resident Evil (2026)、Tenzing、The Love Hypothesis、The Shawshank Redemption、牛来 (Niu Lai)。
- 统一 10 分制初始评分：7.3、7.7、6.6、9.7、6.0。
- 6 家北京影院的名称、地址和 GCJ-02 坐标见 `data/beijing-cinemas-oct2026.json`。
- 首页标题加粗白色，5 部电影每 6 秒轮播，仅保留上一部／下一部按钮。
- 影片、影院、参考票价与排片规则可用随包脚本重建；排片按执行时的北京时间生成未来 7 天。
- 此包是代码交接，不是运行数据库的全量备份，不含当前订单、账户、会话和本机 MySQL 数据目录。

## 新电脑安装（Python 3.11+）

在解压后的项目根目录执行。以下是 macOS／Linux shell 写法；Windows 激活虚拟环境使用 `.venv\Scripts\activate`。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install --no-deps .
```

网站不需要 npm 构建。Node 仅用于可选前端测试，Playwright 用于可选浏览器测试。

## macOS 新建独立演示库（推荐）

需要先安装 MySQL 8.4，并让 `mysql`、`mysqld`、`mysqladmin` 在 PATH 中。`local_mysql.py` 是 macOS／Unix socket 方案，不适用于原生 Windows。仅在刚解压的新目录执行；不要覆盖已经在使用的 `.env.shared` 或数据库。

```bash
mv .env .env.shared
python scripts/local_mysql.py init
```

初始化拒绝覆盖已有 `.env` 或 `instance/mysql`。成功后运行下面的 Python，只把共享的 AI／地图／端口配置复制回新 `.env`，保留新数据库连接和新签名密钥：

```bash
python - <<'PYCONFIG'
from dotenv import dotenv_values, set_key
shared = dotenv_values('.env.shared')
keys = ('AI_PROVIDER', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL',
        'AI_TIMEOUT_SECONDS', 'AMAP_JS_KEY', 'AMAP_SECURITY_CODE', 'PORT')
for key in keys:
    if key in shared and shared[key] is not None:
        set_key('.env', key, shared[key])
print('AI and map configuration copied; local database configuration retained.')
PYCONFIG
python scripts/import_film_programme.py --apply
python scripts/import_cinema_directory.py --apply
python main.py
```

打开 http://127.0.0.1:5001/ 。终端保持运行。账号密码由新电脑初始化生成，见 `instance/DEMO-ACCOUNTS.txt`；新增影院店长账号见 `instance/cinema-directory/new-manager-accounts-*.json`。全新初始化已包含 10 分制 schema，无需重复运行旧评分迁移。

停止网站：Ctrl+C。停止独立 MySQL：`python scripts/local_mysql.py stop`。下次先 `python scripts/local_mysql.py start`，再 `python main.py`。

## 使用自己的 MySQL（含 Windows）

编辑 `.env` 中 `DATABASE_URL` 为自己的 MySQL 8.4 连接，并生成自己的随机 `SECRET_KEY`（至少 32 字符）。保留 `DATA_SOURCE=backend` 和需要的 AI／地图配置。数据库脚本默认只允许 `cinema_demo` 库。

仅对明确的新建空库执行 `flask --app cinema init-db`，然后 `flask --app cinema seed-demo --password <自己设置的演示密码>`，最后依次执行上述两个数据导入脚本。已有队友数据库应先阅读 `docs/integration.md`，不要重新初始化或 seed。

## 无数据库快速检查 AI 页面

macOS／Linux 可临时运行：

```bash
DATA_SOURCE=mock AI_PROVIDER=stub python main.py
```

这只启动模拟 AI 演示，不是完整网站；完整网站仍需要 MySQL。真实 DeepSeek 需要网络访问；高德若限制来源，需要在控制台允许队友实际使用的本地地址或域名。

## 验证与文件清单

```bash
python -m pytest tests -q
node --test tests/frontend/*.test.mjs
```

数据库回归入口见 `scripts/test_mysql.py`，需要已启动的独立 MySQL。`HANDOFF-MANIFEST.json` 记录打包文件、大小与 SHA-256。本次只验证压缩包完整性和原文件一致性，未在队友电脑重新安装或调用付费 API。

根目录原 README 和 `docs/backend-v1`／`docs/fullstack-v1` 含历史交接记录。涉及“密钥不随包”“只有 1 部电影”等旧描述，以本说明和当前代码／data 文件为准。

未打包：Git 历史、IDE 配置、虚拟环境、缓存、构建产物、测试输出、本机数据库与运行日志；这些都不是源码依赖。请按上面的步骤重建运行环境。
