# Feng Xiangyang：选座、交易与视觉

维护责任，不是对已完成代码的作者认领。本文件夹中的文件从团队快照原样复制。

这部分只有四个业务文件，交易逻辑集中。改 `app.css` 时需要和其他三人协调。

## 统计范围内的业务代码：3,714 行（26.0%）

- `cinema/booking.py`（710）
- `cinema/static/js/seats.js`（594）
- `cinema/static/ticketing.css`（297）
- `cinema/static/app.css`（2,113）

## 独立测试：1,044 行

- `tests/browser/customer-smoke.mjs`
- `tests/browser/counter-smoke.mjs`
- `tests/browser/hold-boundary-smoke.mjs`
- `backend_tests/test_rules.py`

## 综合测试中的 276 行

文件 `backend_tests/test_integration.py` 未拆分，不在本文件夹。负责第 121–239、318–389、535–588、639–669 行，包括：

- 占座替换回滚，以及并发辅助函数 `parallel`
- 两人抢同一座位、同一占座并发、跨影院仅一个有效占座
- 重复付款、占座到期、改价后重新报价、余额不足回滚
- 优惠券沿改签继承、零净额改签、改签限制、柜台须顾客授权
- 费率档变化后须重新确认、等待钱包锁后再次检查到期
- 员工只能占顾客已确认的座位

公共接口由 Zheng Weiwen 维护，购票事务的结果需与 Chu Tianze 一起核验。

## 验收重点

不超售、不重复扣款；失败不留下半完成交易；改签失败后原票仍然有效。同时覆盖两人抢座、占座到期、重复提交和余额不足。
