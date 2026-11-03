# 六家北京影院：目录与地图数据交接

2026-10-24 已更新本地 `cinema_demo`，入口：<http://127.0.0.1:5001/#/cinemas>。
影院名称、展示地址依用户的六张截图；地图位置取对应高德 POI 的 GCJ-02 坐标。
影厅、座位、排片和票价继续作为课程项目演示数据，不代表这些实体影院的实际库存或营业安排。

| 展示名称 | 行政区 | 处理方式 | 10/24–10/30 场次 |
| --- | --- | --- | ---: |
| 万达影城(CBD万达广场店) | 朝阳 | 原 Falcons Chaoyang 原位更新 | 40 |
| 万达影城(西铁营店) | 丰台 | 原 Falcons Haidian 原位更新，行政区改为丰台 | 40 |
| 保利国际影城(凯德大峡谷店) | 丰台 | 新增 | 40 |
| 中华电影院 | 西城 | 新增 | 40 |
| 北京站电影院 | 东城 | 原 Falcons Dongcheng 原位更新 | 40 |
| 北京横店影城(王府井百货店) | 东城 | 新增 | 40 |

五部电影保持不变。总计 **6 家影院、6 个演示厅、432 个物理座位、240 场排片、480 条票价**。
已有 120 场的 ID、时间和普通／学生票价均未变化；其影院名称及行政区随目录更新。
新建三厅各使用 12 排 × 6 座的普通厅演示布局，并复用五部电影的七天排片算法。
新厅命名为 `Demo Screen 1`。已有普通／IMAX／Dolby Cinema 厅型作为演示配置保留，并非对实体门店设备的核验结论。
所有影厅按片长留 15 分钟清场，无时间重叠；普通票 36–78 元、学生票 18–39 元。

## 地图坐标与来源差异

| 门店 | 纬度 | 经度 | 高德 POI |
| --- | --- | --- | --- |
| CBD 万达 | 39.9092700 | 116.4706310 | [B000A83VFG](https://ditu.amap.com/place/B000A83VFG) |
| 西铁营万达 | 39.8606850 | 116.3552300 | [B0FFITGR2B](https://www.amap.com/place/B0FFITGR2B) |
| 保利凯德大峡谷 | 39.8546670 | 116.3665840 | [B000A85PQT](https://www.amap.com/place/B000A85PQT) |
| 中华电影院 | 39.8845430 | 116.3982030 | [B0FFJBGE0D](https://www.amap.com/place/B0FFJBGE0D) |
| 北京站电影院 | 39.9037240 | 116.4260310 | [B0FFF2S417](https://www.amap.com/place/B0FFF2S417) |
| 王府井横店 | 39.9139890 | 116.4104130 | [B000ABCE3X](https://ditu.amap.com/place/B000ABCE3X) |

截至核对时，CBD 门店在高德列为“儒意影城(CBD万达广场店)”，中华电影院列为“首都电影院(中华店)”；通过地址、楼层及电话等信息匹配，网站保留用户指定名称。
王府井横店的高德地址为 253 号，截图为 255 号，均指百货大楼北馆 8 层；本站展示截图中的 255 号，差异记录在数据文件中。
用户截图电话号码保存在资料清单的 `reference_phone` 字段，部分与高德现有号码不同；本次没有新增数据库电话字段，也没有增加电话展示功能。

数据清单：`data/beijing-cinemas-oct2026.json`。里面保留坐标来源、截图电话号码、门店对应关系及差异说明。
复用现有 `latitude`、`longitude`、`coordinate_system` 字段，未改定位逻辑、坐标转换、代理白名单、密钥或 AI 代码。
实测高德默认标记图标加载失败，因此仅将 `map-frame.js` 的 Marker 图标改为本站 `cinema-pin.svg`，保持原点击事件和坐标逻辑。
距离仍需用户主动点击“定位我的位置”并授权后才能计算；此次验证没有读取设备位置。

## 账号与备份

原有三个门店的影院 ID、员工角色、账号密码、店长归属、布局和座位 ID 均保留。
因此原 `manager2@cinema.test` 所属门店现在为西铁营万达（丰台），账号名称本身没有改动。
新增三家门店各创建一个仅属本店的演示店长，使用独立随机密码；凭据只写入被 Git 忽略、权限 0600 的本地文件，不写进版本库或聊天内容。

- 原影院和行政区快照：`instance/cinema-directory/before-20261024-124906-610258.json`
- 新门店演示账号：`instance/cinema-directory/new-manager-accounts-20261024-124906-610258.json`
- 迁移结果及影院 ID：`output/cinema-directory/applied-20261024-124906-591057.json`
- 最新完整排片表：`output/cinema-directory/programme-six-cinemas.csv`

快照用于恢复原影院资料，不是完整数据库备份。已有账号和业务记录不会被重置。

## 维护与验证

只读预览：

```sh
.venv/bin/python scripts/import_cinema_directory.py --start-date 2026-10-24 --days 7
```

应用目录：加 `--apply`。脚本仅允许 CLI 连接 `cinema_demo`，事务中统一更新、创建和发布；同名重复或缺少五部电影时整体回滚。
重复执行不会新增门店、账号或重复场次。只为本次新建影厅排片，已有影厅不重排。

后续滚动补排继续使用 `scripts/import_film_programme.py`，现已支持清单中的六家影院；同日期、同影厅、同影片及同票价的场次跳过。
原 `docs/film-programme.md` 和 `output/film-programme/` 记录的是加入电影时的 3 店／120 场初始快照；以本说明及最新 CSV 为当前目录。

```sh
.venv/bin/python scripts/test_mysql.py backend_tests/test_cinema_directory.py backend_tests/test_film_programme.py -q
```

**7 项通过**，使用独立临时库，覆盖原数据与 ID 保留、坐标和行政区、门店权限关联、排片不重叠、重复执行、错误回滚和旧导入功能。
正式库只读核对：6 店、240 场、432 座；原 120 场编号和票价完整保留；每店次日有 6 场，普通查询与 AI 共用目录的推荐卡片对应一致。

地图图标修复后，6 项前端地图/距离计算测试通过。浏览器实测六个影院标记显示、丰台筛出两家门店、新增保利影院的场次及 72 座选座页可打开；没有请求设备定位或提交订单。
地图截图：`output/cinema-directory/six-cinema-map.png`。
