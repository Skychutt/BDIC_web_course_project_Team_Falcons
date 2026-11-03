-- Team Falcons / Cinema design v2. Target: MySQL 8.4, InnoDB, utf8mb4.
-- Run in a NEW, explicitly selected schema; no DROP/CREATE DATABASE here.
-- IDs are application-assigned positive BIGINTs; all money is integer fen.
-- DATETIME(6) stores Beijing local time by application convention.
-- Ledger immutability, permissions, state transitions and cross-row sums are
-- service transaction responsibilities, documented in database-design-zh.pdf.
SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE districts (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '行政区主键',
 admin_code CHAR(6) NOT NULL UNIQUE COMMENT '北京行政区编码',
 name VARCHAR(80) NOT NULL UNIQUE COMMENT '行政区名'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE cinemas (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '影院门店主键',
 district_id BIGINT NOT NULL COMMENT '所属北京行政区',
 name VARCHAR(120) NOT NULL COMMENT '门店名称',
 brand VARCHAR(80) NOT NULL COMMENT '品牌名，不用于跨店授权',
 address VARCHAR(255) NOT NULL COMMENT '详细地址',
 latitude DECIMAL(10,7) NULL COMMENT '门店纬度，可选地图使用',
 longitude DECIMAL(10,7) NULL COMMENT '门店经度',
 coordinate_system VARCHAR(16) NULL COMMENT '坐标系，当前只接 GCJ02',
 manager_user_id BIGINT NULL UNIQUE COMMENT '本店唯一店长，未启用时可空',
 is_active BOOLEAN NOT NULL DEFAULT FALSE COMMENT '启用门店必须有店长',
 CHECK (is_active IN (0,1)),
 CHECK (is_active=0 OR manager_user_id IS NOT NULL),
 CHECK ((latitude IS NULL AND longitude IS NULL AND coordinate_system IS NULL) OR
        (latitude IS NOT NULL AND longitude IS NOT NULL AND coordinate_system IS NOT NULL AND coordinate_system='GCJ02'
         AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
 FOREIGN KEY (district_id) REFERENCES districts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE users (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '用户主键，亦用于顾客占座互斥锁',
 display_name VARCHAR(80) NOT NULL COMMENT '显示姓名',
 email_normalized VARCHAR(254) NOT NULL UNIQUE COMMENT '统一规范化后的登录邮箱',
 password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希，不存明文',
 role VARCHAR(20) NOT NULL COMMENT 'CUSTOMER、STAFF、PLATFORM_ADMIN；店长由影院指定',
 staff_cinema_id BIGINT NULL COMMENT '员工所属影院，其他角色为空',
 created_at DATETIME(6) NOT NULL COMMENT '创建时间',
 CHECK (role IN ('CUSTOMER','STAFF','PLATFORM_ADMIN')),
 CHECK ((role='STAFF' AND staff_cinema_id IS NOT NULL) OR
        (role IN ('CUSTOMER','PLATFORM_ADMIN') AND staff_cinema_id IS NULL)),
 UNIQUE KEY uq_user_branch (id, staff_cinema_id),
 FOREIGN KEY (staff_cinema_id) REFERENCES cinemas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
ALTER TABLE cinemas ADD CONSTRAINT fk_cinema_own_manager
 FOREIGN KEY (manager_user_id,id) REFERENCES users(id,staff_cinema_id);

CREATE TABLE films (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '平台共享影片主键',
 title VARCHAR(200) NOT NULL COMMENT '片名，允许重名',
 synopsis TEXT NOT NULL COMMENT '影片简介，应用限6000字符',
 duration_minutes INT NOT NULL COMMENT '当前目录片长，新排片复制快照',
 archived BOOLEAN NOT NULL DEFAULT FALSE COMMENT '归档后不再新增排片',
 CHECK (duration_minutes>0), CHECK (archived IN (0,1)),
 CHECK (CHAR_LENGTH(synopsis)<=6000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE genres (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '电影类型主键',
 name VARCHAR(60) NOT NULL UNIQUE COMMENT '类型名称'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE film_genres (
 film_id BIGINT NOT NULL COMMENT '影片主键',
 genre_id BIGINT NOT NULL COMMENT '类型主键',
 PRIMARY KEY (film_id,genre_id),
 FOREIGN KEY (film_id) REFERENCES films(id),
 FOREIGN KEY (genre_id) REFERENCES genres(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE ratings (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '评分主键',
 customer_id BIGINT NOT NULL COMMENT '评分顾客，服务层验证角色',
 film_id BIGINT NOT NULL COMMENT '平台影片，不关联影院',
 stars TINYINT NOT NULL COMMENT '1至10分，可修改；字段名保留以兼容接口',
 created_at DATETIME(6) NOT NULL COMMENT '首次评分时间',
 updated_at DATETIME(6) NOT NULL COMMENT '最近修改时间',
 CONSTRAINT ck_ratings_ten_point CHECK (stars BETWEEN 1 AND 10),
 UNIQUE KEY uq_rating_customer_film (customer_id,film_id),
 FOREIGN KEY (customer_id) REFERENCES users(id), FOREIGN KEY (film_id) REFERENCES films(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE screens (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '物理影厅主键，跨布局版本保持不变',
 cinema_id BIGINT NOT NULL COMMENT '所属门店',
 name VARCHAR(80) NOT NULL COMMENT '本店厅名',
 screen_type VARCHAR(20) NOT NULL COMMENT 'STANDARD、IMAX、DOLBY_CINEMA',
 CHECK (screen_type IN ('STANDARD','IMAX','DOLBY_CINEMA')),
 UNIQUE KEY uq_screen_name (cinema_id,name), UNIQUE KEY uq_screen_branch (id,cinema_id),
 FOREIGN KEY (cinema_id) REFERENCES cinemas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE layouts (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '布局版本主键',
 screen_id BIGINT NOT NULL COMMENT '物理影厅',
 version_no INT NOT NULL COMMENT '同厅版本号',
 screen_direction VARCHAR(8) NOT NULL COMMENT 'TOP、BOTTOM、LEFT、RIGHT',
 row_count INT NOT NULL COMMENT '从银幕近端向远端的总排数',
 created_at DATETIME(6) NOT NULL COMMENT '创建时间',
 CHECK (version_no>0 AND row_count>0),
 CHECK (screen_direction IN ('TOP','BOTTOM','LEFT','RIGHT')),
 UNIQUE KEY uq_layout_version (screen_id,version_no), UNIQUE KEY uq_layout_screen (id,screen_id),
 FOREIGN KEY (screen_id) REFERENCES screens(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE seats (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '版本内座位主键',
 layout_id BIGINT NOT NULL COMMENT '所属布局版本',
 row_no INT NOT NULL COMMENT '从银幕近端到远端的排号',
 seat_no INT NOT NULL COMMENT '同排展示及排序座号',
 aisle_segment INT NOT NULL COMMENT '同排不跨过道的区段',
 segment_position INT NOT NULL COMMENT '区段内连续位置，连座判断依据',
 map_x INT NOT NULL COMMENT '界面网格X坐标',
 map_y INT NOT NULL COMMENT '界面网格Y坐标',
 CHECK (row_no>0 AND seat_no>0 AND aisle_segment>0 AND segment_position>0 AND map_x>=0 AND map_y>=0),
 UNIQUE KEY uq_seat_label (layout_id,row_no,seat_no),
 UNIQUE KEY uq_seat_position (layout_id,row_no,aisle_segment,segment_position),
 UNIQUE KEY uq_seat_map (layout_id,map_x,map_y), UNIQUE KEY uq_seat_layout (id,layout_id),
 FOREIGN KEY (layout_id) REFERENCES layouts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE screenings (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '场次主键',
 cinema_id BIGINT NOT NULL COMMENT '受复合外键约束的门店',
 film_id BIGINT NOT NULL COMMENT '共享影片',
 screen_id BIGINT NOT NULL COMMENT '物理影厅',
 layout_id BIGINT NOT NULL COMMENT '本厅布局版本',
 starts_at DATETIME(6) NOT NULL COMMENT '开场时间，开场即停止售票',
 ends_at DATETIME(6) NOT NULL COMMENT '结束时间',
 occupied_until DATETIME(6) NOT NULL COMMENT '准备间隔结束时间',
 duration_minutes_snapshot INT NOT NULL COMMENT '发布时片长快照',
 turnaround_minutes INT NOT NULL DEFAULT 15 COMMENT '当前固定15分钟，保留快照',
 status VARCHAR(12) NOT NULL COMMENT 'PUBLISHED或CANCELLED',
 revision_no INT NOT NULL COMMENT '排片或票价变更的版本号',
 created_at DATETIME(6) NOT NULL COMMENT '创建时间',
 CHECK (status IN ('PUBLISHED','CANCELLED') AND revision_no>0),
 CHECK (duration_minutes_snapshot>0 AND turnaround_minutes=15),
 CHECK (ends_at>starts_at AND occupied_until>ends_at),
 UNIQUE KEY uq_screening_context (id,cinema_id,film_id,layout_id),
 UNIQUE KEY uq_screening_layout (id,layout_id),
 FOREIGN KEY (film_id) REFERENCES films(id),
 FOREIGN KEY (screen_id,cinema_id) REFERENCES screens(id,cinema_id),
 FOREIGN KEY (layout_id,screen_id) REFERENCES layouts(id,screen_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE fares (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '票价记录主键',
 screening_id BIGINT NOT NULL COMMENT '场次',
 fare_type VARCHAR(12) NOT NULL COMMENT 'STANDARD或STUDENT',
 price_minor BIGINT NOT NULL COMMENT '当前票面单价，分',
 CHECK (fare_type IN ('STANDARD','STUDENT') AND price_minor>0),
 UNIQUE KEY uq_fare (screening_id,fare_type),
 FOREIGN KEY (screening_id) REFERENCES screenings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE bookings (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '订单主键',
 owner_id BIGINT NOT NULL COMMENT '顾客所有者',
 creator_id BIGINT NOT NULL COMMENT '操作顾客或柜台员工',
 cinema_id BIGINT NOT NULL COMMENT '门店',
 film_id BIGINT NOT NULL COMMENT '影片',
 screening_id BIGINT NOT NULL COMMENT '当前订单场次',
 layout_id BIGINT NOT NULL COMMENT '场次布局',
 channel VARCHAR(8) NOT NULL COMMENT 'ONLINE或COUNTER',
 status VARCHAR(20) NOT NULL COMMENT 'CONFIRMED、RESCHEDULED、CINEMA_CANCELLED',
 gross_ticket_minor BIGINT NOT NULL COMMENT '票面单价之和',
 price_factor_bps INT NOT NULL COMMENT '10000原价、5000五折；沿链继承',
 net_ticket_minor BIGINT NOT NULL COMMENT '当前折后票款，不含手续费',
 current_fee_minor BIGINT NOT NULL COMMENT '本次改签手续费',
 cumulative_fee_minor BIGINT NOT NULL COMMENT '截至本单整条链累计手续费',
 original_coupon_id BIGINT NULL COMMENT '初购使用的原券，后继仅继承不重核销',
 root_booking_id BIGINT NOT NULL COMMENT '购票链根单；初购指向自己',
 predecessor_id BIGINT NULL UNIQUE COMMENT '唯一前序，防止一单产生多个后继',
 change_no INT NOT NULL COMMENT '初购0，每次改签加1，无固定上限',
 created_at DATETIME(6) NOT NULL COMMENT '创建时间',
 CHECK (channel IN ('ONLINE','COUNTER')),
 CHECK (status IN ('CONFIRMED','RESCHEDULED','CINEMA_CANCELLED')),
 CHECK (gross_ticket_minor>0 AND net_ticket_minor>=0 AND current_fee_minor>=0 AND cumulative_fee_minor>=current_fee_minor),
 CHECK (price_factor_bps IN (5000,10000)),
 CHECK ((original_coupon_id IS NULL AND price_factor_bps=10000) OR (original_coupon_id IS NOT NULL AND price_factor_bps=5000)),
 CHECK (net_ticket_minor=(gross_ticket_minor*price_factor_bps+5000) DIV 10000),
 CHECK ((predecessor_id IS NULL AND change_no=0 AND root_booking_id=id AND current_fee_minor=0 AND cumulative_fee_minor=0)
     OR (predecessor_id IS NOT NULL AND predecessor_id<>id AND change_no>0 AND root_booking_id<>id)),
 UNIQUE KEY uq_booking_owner_branch (id,owner_id,cinema_id),
 UNIQUE KEY uq_booking_chain_context (id,owner_id,cinema_id,film_id),
 UNIQUE KEY uq_booking_seating (id,screening_id,layout_id),
 FOREIGN KEY (owner_id) REFERENCES users(id), FOREIGN KEY (creator_id) REFERENCES users(id),
 FOREIGN KEY (screening_id,cinema_id,film_id,layout_id) REFERENCES screenings(id,cinema_id,film_id,layout_id),
 FOREIGN KEY (root_booking_id,owner_id,cinema_id,film_id) REFERENCES bookings(id,owner_id,cinema_id,film_id),
 FOREIGN KEY (predecessor_id,owner_id,cinema_id,film_id) REFERENCES bookings(id,owner_id,cinema_id,film_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE tickets (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '历史票据主键',
 booking_id BIGINT NOT NULL COMMENT '所属订单',
 screening_id BIGINT NOT NULL COMMENT '受订单外键约束的场次',
 layout_id BIGINT NOT NULL COMMENT '受订单及座位外键约束的布局',
 seat_id BIGINT NOT NULL COMMENT '座位',
 fare_type VARCHAR(12) NOT NULL COMMENT '票种快照',
 face_price_minor BIGINT NOT NULL COMMENT '成交票面单价快照',
 CHECK (fare_type IN ('STANDARD','STUDENT') AND face_price_minor>0),
 UNIQUE KEY uq_ticket_seat (booking_id,seat_id),
 UNIQUE KEY uq_ticket_allocation (id,screening_id,layout_id,seat_id),
 FOREIGN KEY (booking_id,screening_id,layout_id) REFERENCES bookings(id,screening_id,layout_id),
 FOREIGN KEY (seat_id,layout_id) REFERENCES seats(id,layout_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE seat_holds (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '整组占座主键',
 owner_id BIGINT NOT NULL COMMENT '顾客',
 creator_id BIGINT NOT NULL COMMENT '顾客或柜台员工',
 cinema_id BIGINT NOT NULL COMMENT '目标门店',
 film_id BIGINT NOT NULL COMMENT '目标影片',
 screening_id BIGINT NOT NULL COMMENT '目标场次',
 layout_id BIGINT NOT NULL COMMENT '目标布局',
 source_booking_id BIGINT NULL COMMENT '改签原单，初购为空',
 status VARCHAR(12) NOT NULL COMMENT 'ACTIVE、CONVERTED、EXPIRED、CANCELLED',
 created_at DATETIME(6) NOT NULL COMMENT '建立时间，重试不覆盖',
 expires_at DATETIME(6) NOT NULL COMMENT 'min(建立+5分钟,开场)',
 quote_revision INT NOT NULL COMMENT '最近一次服务器报价对应场次版本',
 quote_hash CHAR(64) NULL COMMENT '确认票种、券和费用后保存的报价摘要',
 active_customer_id BIGINT GENERATED ALWAYS AS (CASE WHEN status='ACTIVE' THEN owner_id ELSE NULL END) STORED COMMENT '唯一有效占座约束用派生列',
 CHECK (status IN ('ACTIVE','CONVERTED','EXPIRED','CANCELLED')),
 CHECK (expires_at>created_at AND quote_revision>0),
 UNIQUE KEY uq_hold_active_customer (active_customer_id),
 UNIQUE KEY uq_hold_seating (id,screening_id,layout_id),
 FOREIGN KEY (owner_id) REFERENCES users(id), FOREIGN KEY (creator_id) REFERENCES users(id),
 FOREIGN KEY (screening_id,cinema_id,film_id,layout_id) REFERENCES screenings(id,cinema_id,film_id,layout_id),
 FOREIGN KEY (source_booking_id,owner_id,cinema_id,film_id) REFERENCES bookings(id,owner_id,cinema_id,film_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE seat_allocations (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '当前占用主键；失效即删，历史另存',
 screening_id BIGINT NOT NULL COMMENT '占用场次',
 layout_id BIGINT NOT NULL COMMENT '占用布局',
 seat_id BIGINT NOT NULL COMMENT '占用座位',
 state VARCHAR(8) NOT NULL COMMENT 'HELD或SOLD，不存EXPIRED历史行',
 hold_id BIGINT NULL COMMENT 'HELD时非空',
 ticket_id BIGINT NULL UNIQUE COMMENT 'SOLD时非空',
 CHECK ((state='HELD' AND hold_id IS NOT NULL AND ticket_id IS NULL) OR
        (state='SOLD' AND hold_id IS NULL AND ticket_id IS NOT NULL)),
 UNIQUE KEY uq_allocation_seat (screening_id,seat_id),
 FOREIGN KEY (screening_id,layout_id) REFERENCES screenings(id,layout_id),
 FOREIGN KEY (seat_id,layout_id) REFERENCES seats(id,layout_id),
 FOREIGN KEY (hold_id,screening_id,layout_id) REFERENCES seat_holds(id,screening_id,layout_id),
 FOREIGN KEY (ticket_id,screening_id,layout_id,seat_id) REFERENCES tickets(id,screening_id,layout_id,seat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE operations (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '原子业务操作主键',
 actor_id BIGINT NOT NULL COMMENT '操作者',
 request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '每次动作的幂等键，按操作者唯一',
 payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '规范化业务输入哈希',
 operation_type VARCHAR(24) NOT NULL COMMENT 'REGISTER、HOLD、PURCHASE、RESCHEDULE、CANCEL_SCREENING、REPLACE_SCREENING',
 source_booking_id BIGINT NULL COMMENT '原单',
 result_booking_id BIGINT NULL COMMENT '成功新单',
 source_screening_id BIGINT NULL COMMENT '原场次',
 result_screening_id BIGINT NULL COMMENT '替代场次',
 result_hold_id BIGINT NULL COMMENT '成功占座结果',
 reason VARCHAR(500) NULL COMMENT '变更原因',
 result_json JSON NOT NULL COMMENT '已提交回执，后续退款进度另查',
 created_at DATETIME(6) NOT NULL COMMENT '操作提交时间，不充当延后退款成功时间',
 CHECK (operation_type IN ('REGISTER','HOLD','PURCHASE','RESCHEDULE','CANCEL_SCREENING','REPLACE_SCREENING')),
 UNIQUE KEY uq_operation_request (actor_id,request_key),
 FOREIGN KEY (actor_id) REFERENCES users(id),
 FOREIGN KEY (source_booking_id) REFERENCES bookings(id), FOREIGN KEY (result_booking_id) REFERENCES bookings(id),
 FOREIGN KEY (source_screening_id) REFERENCES screenings(id), FOREIGN KEY (result_screening_id) REFERENCES screenings(id),
 FOREIGN KEY (result_hold_id) REFERENCES seat_holds(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE wallets (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '钱包主键',
 customer_id BIGINT NOT NULL UNIQUE COMMENT '一名顾客一个平台钱包',
 balance_minor BIGINT NOT NULL DEFAULT 0 COMMENT '余额，分，不得为负',
 updated_at DATETIME(6) NOT NULL COMMENT '最近入账时间',
 CHECK (balance_minor>=0),
 UNIQUE KEY uq_wallet_owner (id,customer_id),
 FOREIGN KEY (customer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE payments (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '成功扣款主键',
 booking_id BIGINT NOT NULL COMMENT '购票单或改签新单',
 operation_id BIGINT NOT NULL COMMENT '业务操作',
 owner_id BIGINT NOT NULL COMMENT '顾客',
 cinema_id BIGINT NOT NULL COMMENT '归属门店',
 wallet_id BIGINT NOT NULL COMMENT '顾客钱包',
 amount_minor BIGINT NOT NULL COMMENT '实际扣款正金额',
 status VARCHAR(12) NOT NULL COMMENT '仅SUCCEEDED，失败整笔回滚',
 settled_at DATETIME(6) NOT NULL COMMENT '成功时间',
 CHECK (status='SUCCEEDED' AND amount_minor>0),
 UNIQUE KEY uq_payment_source (operation_id,booking_id),
 UNIQUE KEY uq_payment_ledger (id,operation_id,owner_id,wallet_id),
 UNIQUE KEY uq_payment_settlement (id,operation_id,booking_id,cinema_id),
 FOREIGN KEY (booking_id,owner_id,cinema_id) REFERENCES bookings(id,owner_id,cinema_id),
 FOREIGN KEY (wallet_id,owner_id) REFERENCES wallets(id,customer_id),
 FOREIGN KEY (operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE refunds (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '退款任务主键，重试复用',
 booking_id BIGINT NOT NULL COMMENT '改签新单或被影院取消的有效单',
 operation_id BIGINT NOT NULL COMMENT '来源操作，不随重试改变',
 owner_id BIGINT NOT NULL COMMENT '顾客',
 cinema_id BIGINT NOT NULL COMMENT '门店',
 wallet_id BIGINT NOT NULL COMMENT '接收钱包',
 reason VARCHAR(24) NOT NULL COMMENT 'RESCHEDULE_DIFFERENCE或CINEMA_CANCELLATION',
 amount_minor BIGINT NOT NULL COMMENT '实际入账正金额',
 status VARCHAR(12) NOT NULL COMMENT 'PENDING、FAILED、SUCCEEDED',
 attempt_count INT NOT NULL DEFAULT 0 COMMENT '已执行次数',
 last_error VARCHAR(500) NULL COMMENT '最近失败原因',
 created_at DATETIME(6) NOT NULL COMMENT '建立任务时间',
 settled_at DATETIME(6) NULL COMMENT '实际成功时间；成功前为空',
 cancellation_booking_id BIGINT GENERATED ALWAYS AS (CASE WHEN reason='CINEMA_CANCELLATION' THEN booking_id ELSE NULL END) STORED COMMENT '同单影院取消退款唯一',
 CHECK (reason IN ('RESCHEDULE_DIFFERENCE','CINEMA_CANCELLATION')),
 CHECK (amount_minor>0 AND attempt_count>=0),
 CHECK ((status='SUCCEEDED' AND settled_at IS NOT NULL) OR (status IN ('PENDING','FAILED') AND settled_at IS NULL)),
 UNIQUE KEY uq_refund_source (operation_id,booking_id,reason),
 UNIQUE KEY uq_refund_cancellation (cancellation_booking_id),
 UNIQUE KEY uq_refund_ledger (id,operation_id,owner_id,wallet_id),
 UNIQUE KEY uq_refund_settlement (id,operation_id,booking_id,cinema_id),
 FOREIGN KEY (booking_id,owner_id,cinema_id) REFERENCES bookings(id,owner_id,cinema_id),
 FOREIGN KEY (wallet_id,owner_id) REFERENCES wallets(id,customer_id),
 FOREIGN KEY (operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE wallet_entries (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '不可改写的钱包流水主键',
 wallet_id BIGINT NOT NULL COMMENT '钱包',
 owner_id BIGINT NOT NULL COMMENT '钱包所有者',
 operation_id BIGINT NOT NULL COMMENT '注册、购票、改签或取消操作',
 entry_type VARCHAR(16) NOT NULL COMMENT 'INITIAL_CREDIT、PAYMENT、REFUND',
 amount_minor BIGINT NOT NULL COMMENT '有符号金额，入账正、扣款负',
 balance_after_minor BIGINT NOT NULL COMMENT '持钱包锁时计算的变更后余额',
 payment_id BIGINT NULL UNIQUE COMMENT '付款来源，唯一防重复扣款',
 refund_id BIGINT NULL UNIQUE COMMENT '退款来源，唯一防重复入账',
 created_at DATETIME(6) NOT NULL COMMENT '实际余额变更时间',
 initial_credit_wallet_id BIGINT GENERATED ALWAYS AS (CASE WHEN entry_type='INITIAL_CREDIT' THEN wallet_id ELSE NULL END) STORED COMMENT '每钱包只有一次初始额度',
 CHECK (balance_after_minor>=0),
 CHECK ((entry_type='INITIAL_CREDIT' AND amount_minor=100000 AND payment_id IS NULL AND refund_id IS NULL) OR
        (entry_type='PAYMENT' AND amount_minor<0 AND payment_id IS NOT NULL AND refund_id IS NULL) OR
        (entry_type='REFUND' AND amount_minor>0 AND refund_id IS NOT NULL AND payment_id IS NULL)),
 UNIQUE KEY uq_initial_credit (initial_credit_wallet_id),
 FOREIGN KEY (wallet_id,owner_id) REFERENCES wallets(id,customer_id),
 FOREIGN KEY (operation_id) REFERENCES operations(id),
 FOREIGN KEY (payment_id,operation_id,owner_id,wallet_id) REFERENCES payments(id,operation_id,owner_id,wallet_id),
 FOREIGN KEY (refund_id,operation_id,owner_id,wallet_id) REFERENCES refunds(id,operation_id,owner_id,wallet_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE settlement_entries (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '影院成功结算分项主键',
 operation_id BIGINT NOT NULL COMMENT '来源业务操作',
 booking_id BIGINT NOT NULL COMMENT '当前购票单、改签新单或取消单',
 owner_id BIGINT NOT NULL COMMENT '订单顾客，供复合归属约束',
 cinema_id BIGINT NOT NULL COMMENT '统计门店',
 component VARCHAR(8) NOT NULL COMMENT 'TICKET或FEE',
 amount_minor BIGINT NOT NULL COMMENT '有符号分项，非零；票款差额可为负',
 cash_kind VARCHAR(8) NOT NULL COMMENT 'PAYMENT、REFUND、ZERO',
 payment_id BIGINT NULL COMMENT '对应扣款，可空',
 refund_id BIGINT NULL COMMENT '对应成功退款，可空',
 settled_at DATETIME(6) NOT NULL COMMENT '结算成功时间，F10按此日期统计',
 CHECK (component IN ('TICKET','FEE') AND amount_minor<>0),
 CHECK ((cash_kind='PAYMENT' AND payment_id IS NOT NULL AND refund_id IS NULL) OR
        (cash_kind='REFUND' AND refund_id IS NOT NULL AND payment_id IS NULL) OR
        (cash_kind='ZERO' AND payment_id IS NULL AND refund_id IS NULL)),
 UNIQUE KEY uq_settlement_component (operation_id,booking_id,component),
 FOREIGN KEY (operation_id) REFERENCES operations(id),
 FOREIGN KEY (booking_id,owner_id,cinema_id) REFERENCES bookings(id,owner_id,cinema_id),
 FOREIGN KEY (payment_id,operation_id,booking_id,cinema_id) REFERENCES payments(id,operation_id,booking_id,cinema_id),
 FOREIGN KEY (refund_id,operation_id,booking_id,cinema_id) REFERENCES refunds(id,operation_id,booking_id,cinema_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE coupons (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '五折补偿券主键',
 owner_id BIGINT NOT NULL COMMENT '所属顾客',
 cinema_id BIGINT NOT NULL COMMENT '发券具体门店',
 source_booking_id BIGINT NOT NULL UNIQUE COMMENT '被影院取消的有效单，一单一券',
 price_factor_bps INT NOT NULL DEFAULT 5000 COMMENT '票款乘数固定为5000/10000',
 status VARCHAR(12) NOT NULL COMMENT 'AVAILABLE或USED',
 redeemed_booking_id BIGINT NULL UNIQUE COMMENT '初购核销订单，后继改签不重核销',
 issued_at DATETIME(6) NOT NULL COMMENT '发券时间，无到期字段',
 redeemed_at DATETIME(6) NULL COMMENT '核销时间',
 CHECK (price_factor_bps=5000),
 CHECK ((status='AVAILABLE' AND redeemed_booking_id IS NULL AND redeemed_at IS NULL) OR
        (status='USED' AND redeemed_booking_id IS NOT NULL AND redeemed_at IS NOT NULL)),
 CHECK (redeemed_booking_id IS NULL OR redeemed_booking_id<>source_booking_id),
 UNIQUE KEY uq_coupon_owner_branch (id,owner_id,cinema_id),
 FOREIGN KEY (source_booking_id,owner_id,cinema_id) REFERENCES bookings(id,owner_id,cinema_id),
 FOREIGN KEY (redeemed_booking_id,owner_id,cinema_id) REFERENCES bookings(id,owner_id,cinema_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
ALTER TABLE bookings ADD CONSTRAINT fk_booking_original_coupon
 FOREIGN KEY (original_coupon_id,owner_id,cinema_id) REFERENCES coupons(id,owner_id,cinema_id);
CREATE TABLE notices (
 id BIGINT NOT NULL PRIMARY KEY COMMENT '站内通知主键',
 owner_id BIGINT NOT NULL COMMENT '接收顾客',
 cinema_id BIGINT NOT NULL COMMENT '来源影院',
 booking_id BIGINT NOT NULL COMMENT '被取消订单',
 operation_id BIGINT NOT NULL COMMENT '来源取消操作',
 body VARCHAR(2000) NOT NULL COMMENT '通知正文，退款与券进度另查',
 created_at DATETIME(6) NOT NULL COMMENT '建立时间',
 read_at DATETIME(6) NULL COMMENT '本人已读时间，未读为空',
 UNIQUE KEY uq_notice_source (operation_id,booking_id),
 FOREIGN KEY (booking_id,owner_id,cinema_id) REFERENCES bookings(id,owner_id,cinema_id),
 FOREIGN KEY (operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE INDEX idx_cinema_district ON cinemas(district_id,is_active);
CREATE INDEX idx_genre_film ON film_genres(genre_id,film_id);
CREATE INDEX idx_rating_film ON ratings(film_id,stars);
CREATE INDEX idx_screening_screen_time ON screenings(screen_id,status,starts_at,occupied_until);
CREATE INDEX idx_screening_branch_time ON screenings(cinema_id,status,starts_at);
CREATE INDEX idx_screening_film_time ON screenings(film_id,status,starts_at);
CREATE INDEX idx_booking_owner_time ON bookings(owner_id,created_at);
CREATE INDEX idx_booking_screening_state ON bookings(screening_id,status);
CREATE INDEX idx_booking_root ON bookings(root_booking_id,change_no);
CREATE INDEX idx_hold_expiry ON seat_holds(status,expires_at);
CREATE INDEX idx_hold_owner ON seat_holds(owner_id,status);
CREATE INDEX idx_wallet_history ON wallet_entries(wallet_id,created_at,id);
CREATE INDEX idx_refund_retry ON refunds(status,created_at);
CREATE INDEX idx_settlement_turnover ON settlement_entries(cinema_id,settled_at,component);
CREATE INDEX idx_coupon_wallet ON coupons(owner_id,cinema_id,status);
CREATE INDEX idx_notice_owner ON notices(owner_id,read_at,created_at);
