# 五部影片与七天演示排片

> 后续更新：同日已按用户新截图扩展为六家影院、240 场，原 120 场编号和票价保留。当前目录及完整排片表见 [六家影院交接](cinema-directory.md)；本文保留首次导入时的三店快照。

2026-10-24 已写入本地 MySQL `cinema_demo`，网站地址为 <http://127.0.0.1:5001/>。
这是课程项目的模拟经营排期；票价、影院排片及厅型安排由本站制定，不代表实际发行、当地上映或特殊格式授权。

## 已加入的影片

| 影片 | 片长（分钟） | 类型 | 七天场数 |
| --- | ---: | --- | ---: |
| Resident Evil (2026)／生化危机（2026） | 94 | 恐怖、惊悚 | 32 |
| Tenzing／丹增 | 125 | 冒险、传记、剧情 | 18 |
| The Love Hypothesis／爱情假说 | 112 | 爱情、喜剧 | 31 |
| Shaun the Sheep: The Beast of Mossy Bottom／小羊肖恩：苔藓农场的怪兽（暂译） | 80 | 动画、家庭、喜剧 | 18 |
| The Shawshank Redemption／肖申克的救赎 | 142 | 剧情、犯罪 | 21 |

中文片名仅作交接说明；数据库使用海报英文片名（Resident Evil 加年份避免混淆）。
片长采用来源的分钟值；小羊肖恩的分类记录为 80 分 28 秒，当前数据模型只支持整数分钟，按来源的约 80 分钟记录，另有 15 分钟清场时间。
简介为概括性改写。后续已按要求将初始评分统一到本站 10 分制，首页、详情与 AI 使用同一评分；详情见 [集成契约](integration.md#统一-10-分制评分2026-10-24)。

用户提供的五张 PNG 海报已原样复制到 `cinema/static/assets/`。
`cinema/static/js/film-artwork.js` 维护标题与本地海报的映射，影片卡片、详情和场次列表共用 `poster()`。
为了与正在进行的后端工作隔离，本次没有增加数据库字段；以后若需管理员上传海报，可将映射迁移为正式资源字段。

## 排片与价格

日期：**2026-10-24 至 2026-10-30**，全部采用北京时间。
共 **120 场**，朝阳／海淀／东城各 **40 场**。每厅保留原有 **72 个座位**。
首日已过及距离导入时间不足 45 分钟的场次不发布，因此 10 月 24 日从下午场开始；10 月 25 日起每天可选全部五部影片。

| 每日基准开场 | 影片 |
| --- | --- |
| 10:00 | 小羊肖恩 |
| 12:00 | Tenzing |
| 14:40 | The Love Hypothesis |
| 17:15 | The Shawshank Redemption |
| 20:00 | Resident Evil (2026) |
| 22:00 | The Love Hypothesis / Resident Evil 按日期与影厅轮换 |

朝阳普通厅采用基准时间；海淀 IMAX 延后 20 分钟；东城 Dolby Cinema 延后 40 分钟。
每场按影片片长计算结束时间，再预留至少 15 分钟清场，同一物理影厅没有重叠。
夜场可能在次日凌晨结束，列表中的排片日期仍以开场日期为准。

普通票基础价（元）：小羊肖恩 36，Tenzing 45，爱情假说 42，肖申克 40，生化危机 48。
IMAX 加 20 元，Dolby Cinema 加 16 元，周六周日加 6 元；17:00—21:59 开场加 4 元，22:00 起减 6 元。
学生票为对应普通票的 50%，金额全部存为整数分。此次普通票范围 **36–78 元**，学生票 **18–39 元**。
优惠券和最终结算继续使用原后端规则。

## 删除、备份与重跑

原来的 `Journey Beyond the City` 及其 **9 个场次、18 条票价** 已删除。
执行时它没有订单、占座、评分、座位分配或相关操作记录。影院、坐标、影厅、布局、用户、钱包均未修改。

- 删除前备份：`instance/film-programme/backups/removed-seed-20261024-123226-636720.json`
- 完整排片 CSV：`output/film-programme/20261024-123226-614377.csv`
- 导入结果（含影片、场次 ID）：`output/film-programme/20261024-123226-614377.json`
- 海报页面截图：`output/film-programme/five-films.png`

备份保存被删除的影片、类型关联、场次和票价原始行，权限为 0600。它是删除前数据快照，不是整库备份。
恢复旧场次前需先处理其与新排片的时间冲突；不要直接重新执行旧的 `seed-demo`。
原 `instance/demo-ids.json` 中的旧电影／场次 ID 已过期；账号和影院等 ID 未变。新场次请查询 API 或上面的导入结果文件。

先预览（只读）：

```sh
.venv/bin/python scripts/import_film_programme.py --start-date 2026-10-24 --days 7
```

确认排期后应用：

```sh
.venv/bin/python scripts/import_film_programme.py --start-date 2026-10-24 --days 7 --apply
```

不指定日期时默认从北京时间当天开始；可通过 `--days` 指定 1–14 天。
同一天、同一影厅、相同影片和价格会跳过，不重复新增。轮换按日历日期固定，滚动补排也不会改变已有日期的影片。
如果原电影后来有用户历史，或者已有排片、片长、票价被修改，脚本会中止并整批回滚，让管理员先检查差异。
脚本只允许 CLI 写入 `cinema_demo`；不会重置数据库、改位置数据或调用 AI。

## 验证

```sh
.venv/bin/python scripts/test_mysql.py backend_tests/test_film_programme.py -q
```

5 项测试通过，数据库测试均使用随机临时库，覆盖清场间隔、未来场次、价格与稳定轮换、重复执行、原有数据保护、历史记录拒删、冲突回滚、改价保护及目录接口。
正式库只读检查覆盖五部影片、120 场、240 条票价、零排期冲突、七个可选日期。五部影片的普通搜索与 AI 共用目录均返回匹配的真实场次，座位预览接口正常。浏览器已验证五张海报、影片详情、场次筛选以及包含 72 个座位和正确参考价的选座页，不提交购票、不调用真实模型。

## 影片资料来源

- Resident Evil：[Sony 简介](https://www.sonypictures.com/movies/residentevil8)、[BBFC 片长](https://www.bbfc.co.uk/release/resident-evil-q29sbgvjdglvbjpwwc0xmte2mjkx)。
- Tenzing：[Apple 影片资料](https://www.apple.com/uk/tv-pr/originals/tenzing/)、[Apple TV 片长](https://tv.apple.com/us/movie/tenzing/umc.cmc.6lic0hhuxkrbem0n29vzjopii)。
- The Love Hypothesis：[Prime Video 影片资料与片长](https://www.primevideo.com/detail/0IH8VKXSSIAXGDCWKPS2UU3HZT)。
- Shaun the Sheep：[官方介绍](https://www.shaunthesheep.com/news/2025/a-new-shaun-the-sheep-film-releases-in-2026/)、[BBFC 片长](https://www.bbfc.co.uk/release/shaun-the-sheep-the-beast-of-mossy-bottom-q29sbgvjdglvbjpwwc0xmdmxmtuz)。
- The Shawshank Redemption：[BFI 影片资料](https://www.bfi.org.uk/film/27458270-29df-5059-803c-b4e4bef9912b/the-shawshank-redemption)。

机器可读资料和来源集中保存在 `data/film-programme-oct2026.json`。
