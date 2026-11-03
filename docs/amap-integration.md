# 高德地图与定位接入

入口：完整网站的 **Cinemas / 影院** 页面 `http://127.0.0.1:5001/#/cinemas`。页面可切换中英文。

## 本地配置

在项目根目录 `.env` 配置，**值必须紧跟等号，不可单独放到下一行**：

```dotenv
AMAP_JS_KEY=YOUR_WEB_JS_API_KEY
AMAP_SECURITY_CODE=YOUR_SECURITY_JS_CODE
```

使用同一个高德应用下的 Web端（JS API）Key 与 securityJsCode。修改后重启 `python main.py`。
`.env` 已被 Git 忽略；JS Key 是浏览器公开标识，securityJsCode 仅由 Flask 代理使用。
当前实现无需另申请 Web 服务 Key。部署时在高德控制台设置实际站点域名限制，并通过 HTTPS 访问。

官方参考：[Key 申请](https://lbs.amap.com/api/javascript-api-v2/prerequisites)、[安全密钥与代理](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)、[定位与浏览器限制](https://lbs.amap.com/api/javascript-api-v2/guide/services/geolocation)。

## 当前行为

- 点击“显示地图”才加载高德 SDK，默认地图中心为北京。
- 点击“定位我的位置”才请求浏览器设备定位；拒绝、超时、不支持或非安全连接都有提示，可继续手动筛选行政区。
- 浏览器定位得到 WGS-84 坐标，经高德 `convertFrom(..., 'gps')` 转换为 GCJ-02，再解析行政区。
- 影院坐标也必须是 GCJ-02。距离由浏览器按球面距离计算，明确标为**直线距离**，不是驾车/步行距离。相同距离按影院名与 ID 确定顺序；无坐标影院排在有距离影院后面。
- 只展示平台已有、启用中的影院；没有接入高德 POI 搜索，因此不会把外部影院当作可售影院。
- 位置仅保留在当前影院页面的内存，10 分钟自动清除；清除位置或离开页面也会删除。没有写入 Cookie、localStorage、数据库或 AI 对话。
- AI 被问到“附近/最近影院”时提供固定地图入口，不读取用户设备位置、不推测距离、不自动改变聊天筛选条件。地图选定影院后可直接进入其正式场次页面。
- 系统目前只服务北京；解析为外地时明确提示，不更改 AI 中已经确认的城市。

## 给数据库/后台队友

已复用 `cinemas.latitude`、`longitude`、`coordinate_system`，无需建表或迁移。
完整网站的 **Platform console → Cinemas → 编辑影院 → Map coordinates (optional)** 已有录入表单。
填写经纬度后保存，表单提交 `coordinate_system=GCJ02`；清空时同时清空两项。
请使用影院真实地址对应的高德坐标，不能直接填写 GPS/WGS-84 或百度 BD-09 坐标。

2026-10-24 后续已按用户提供的截图更新为 6 家北京影院，并补齐对应高德 POI 的 GCJ-02 坐标。
地图现在可以展示这 6 家影院标记；用户主动定位授权后可计算直线距离。门店名称、地址、坐标来源、演示排片和迁移说明见 [六家影院交接](cinema-directory.md)。

## 模块与接口

| 文件/接口 | 用途 |
| --- | --- |
| `cinema/maps.py` | 配置读取、只读服务代理、地图子页面 |
| `GET /api/maps/config` | 返回 enabled、公开 JS Key、同站代理路径；不返回安全密钥 |
| `GET /_AMapService/<service>` | 固定转发到 `https://restapi.amap.com` 并注入服务端安全密钥 |
| `GET /maps/embed` | 专用地图 iframe，主站仍保持严格脚本 CSP |
| `cinema/static/js/cinema-map.js` | 双语界面、定位状态、筛选、排序、生命周期 |
| `amap.js` / `map-frame.js` / `amap-sdk.js` | 浏览器权限、消息桥接、SDK 与坐标转换 |
| `geo.js` | GCJ-02 数据检查和距离计算 |

代理仅允许本功能需要的固定服务路径，不接受目标 URL、不跟随重定向、不转发 Cookie/Authorization，覆盖客户端 key/jscode，限制请求与响应大小、超时与请求频率。SDK 日志和服务访问 URL 不记录，以免保存密钥或经纬度。部署网关的访问日志也应对该代理路径关闭查询串记录。

高德 SDK 需要动态脚本编译；仅 `/maps/embed` 的 CSP 允许 `unsafe-eval`，主页面和 API 保持原策略。iframe 消息校验来源窗口、同站 origin 和消息类型；影院 ID 还必须存在于当前平台目录。此 iframe 用于限定脚本策略与生命周期，不是独立域名的安全隔离。

## 验证与限制

2026-10-24 已完成：

- 私有 MySQL 随机测试库回归 166 项通过，未改动演示库。
- 独立地图 iframe 改造后，地图/主页面/Agent 定向回归 36 项通过。
- 前端链接、距离计算、坐标转换和权限失败分支共 11 项 Node 测试通过。
- 真实高德 JS API 地图在浏览器显示北京底图；使用公开北京坐标调用转换、逆地理编码服务均返回 `10000` 成功。
- 真实 DeepSeek＋本机 MySQL 联调“离我最近的电影院”，返回明确的定位引导与本站固定地图入口；浏览器点击入口可打开影院页面，行政区筛选可缩小到单家影院。
- 未读取或授权开发者个人设备位置。实际 GPS/系统权限仍需本人在页面点击定位验证；桌面设备定位精度取决于系统与浏览器。

```bash
.venv/bin/python scripts/test_mysql.py -q
npm run check:maps
```

自动回归使用替身，不请求真实高德 API。`scripts/test_mysql.py` 会覆盖为空的地图密钥，防止测试消耗个人配额。
