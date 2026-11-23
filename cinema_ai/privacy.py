"""Recognize requests for restricted records before planning; tools enforce actual access."""
import re
import unicodedata


# Some terms identify an internal metric on their own. For ambiguous terms such
# as income and box office, require a venue or business context.
INTERNAL_RECORD = re.compile(
    r"营业额|营业收入|营收|销售额|总收入|毛利|净利|利润|上座率|客流(?:量|统计|报告)|售票量|"
    r"(?:内部|后台|财务|经营|运营|销售|结算|对账)(?:的)?(?:数据|信息|报表|报告|账本|账单|流水|明细|记录|台账)|"
    r"售票(?:数量|统计)|未公开(?:的)?排片|"
    r"(?:员工|店员|职员)(?:的)?(?:名册|名单|排班|工资|薪资|电话|联系方式)|"
    r"(?:顾客|客户|会员)(?:的)?(?:名单|名册|资料库|数据库|通讯录|邮箱列表)|"
    r"(?:其他(?:人|顾客|客户|用户)|他人|别人|所有(?:顾客|用户)|全平台)(?:的)?(?:订单|优惠券|账户|账号|联系方式|手机号|购票记录)|"
    r"\b(?:revenues?|turnover|payroll|profits?|profit margins?|occupancy rates?|ticket sales (?:figures|report)|settlement entries)\b|"
    r"\b(?:internal|financial|management|sales|settlement|reconciliation) (?:data|reports?|records?|ledgers?|figures|dashboard)\b|"
    r"\b(?:all customer (?:orders|bookings)|unpublished (?:screenings?|schedules?)|net_settled_minor)\b|"
    r"\b(?:staff|employee) (?:rosters?|schedules?|salaries|contact details)|\bcustomer (?:lists?|database|emails?)\b|"
    r"\b(?:other (?:customers?|people|users?)|all customers|someone else)['’s ]+\s*(?:orders?|bookings?|accounts?)\b"
)
VENUE = re.compile(r"影院|影城|电影院|门店|分店|这家店|本店|全店|全站|平台|你们|\b(?:cinemas?|theat(?:er|re)s?|branch|venue|platform|your business)\b")
VENUE_METRIC = re.compile(
    r"收入|流水|赚[了到]?|挣[了到]?|盈利|销售总|票房|订单总数|"
    r"\b(?:revenues?|profits?|earnings|takings|income|grossed|ticket sales|tickets sold|box.office (?:receipts|gross))\b|"
    r"\bhow much\b.{0,65}\b(?:make|take in|earn|bring in|made|earned)\b|"
    r"\b(?:make|take in|earn|bring in|made|earned)\b.{0,20}\b(?:money|yesterday|last|today)\b"
)
SALES_QUERY = re.compile(
    r"(?:卖[了出]?|售出|卖掉)了?(?:多少|几)(?:张|套)?(?:电影)?票|(?:售票|出票)(?:总数|统计)|"
    r"已售.{0,12}(?:座位|票数).{0,20}(?:乘|票价|估算|倒推)|"
    r"(?:赚|挣|进账|入账)(?:了)?多少|\b(?:how many tickets (?:were |have been |have you )?sold|how many tickets did .{1,40}? sell|"
    r"(?:sold seats|seats sold|tickets sold).{0,30}(?:multiplied|times|ticket price)|"
    r"(?:total|daily|monthly|(?:today|yesterday)['’]s) (?:ticket )?sales|how much (?:money )?did you (?:make|earn))\b"
)
PUBLIC_BOX_OFFICE = re.compile(r"(?:全球|北美|全国)(?:累计|总)?票房|(?:worldwide|global|domestic) box.office (?:revenue|gross)")
# After a refusal, ambiguous continuations refer to the denied request. An
# explicit customer task can resume the prior public filters and candidates.
CUSTOMER_TOPIC = re.compile(
    r"电影|影片|场次|排片|座位|连座|票价|票种|学生票|优惠券|改签|退票|我的订单|我[的买].{0,4}票|"
    r"营业时间|开门|地址|评分|片长|剧情|主演|导演|推荐|几个人|[两三四五六七八九十\d]+个人|"
    r"\b(?:films?|movies?|screenings?|showtimes?|seats?|ticket prices?|student tickets?|coupons?|"
    r"refunds?|reschedul\w*|my (?:tickets?|orders?|bookings?)|opening hours|address|ratings?|recommend\w*)\b"
)


def internal_data_request(text, *, after_refusal=False):
    text = unicodedata.normalize("NFKC", text).casefold()
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Cf")
    text = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", text)
    text = " ".join(text.split())
    business_text = PUBLIC_BOX_OFFICE.sub("", text)
    return bool(INTERNAL_RECORD.search(business_text) or SALES_QUERY.search(business_text)
                or (VENUE.search(business_text) and VENUE_METRIC.search(business_text))
                or (after_refusal and not CUSTOMER_TOPIC.search(text)))
