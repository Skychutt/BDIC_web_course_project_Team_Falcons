"""Small, explicit bilingual UI and response vocabulary."""
TEXT = {
    "help": ("我可以查询影片、影院、购票规则，或按区域、时间、人数和座位偏好推荐场次。试试：今晚朝阳区三个人看电影 A，尽量坐中间。", "I can look up films, cinemas and booking rules, or recommend screenings by district, time, party size and seating preference. Try: Three people, movie A, Chaoyang tonight, middle seats."),
    "unsupported": ("我可以查询影片、场次、规则，以及登录后本人的订单和优惠券；不能读取他人数据、余额、营业额、密钥或执行 SQL、购票等操作。", "I can query films, screenings, rules and your own orders/coupons after sign-in. I cannot access other people's data, wallets, revenue or credentials, execute SQL or perform transactions."),
    "party_size": ("一共有几位观众？确认人数后才能检查整组座位。", "How many people are going? I need the party size to check seats for the whole group."),
    "time": ("请明确日期或开场时间范围，例如明天 18:00–22:00。其他已确认条件已保留。", "Please specify the date or start-time range, for example tomorrow 18:00–22:00. Your other confirmed preferences are retained."),
    "region": ("请明确北京市内行政区，或选择北京全市。", "Please specify a Beijing district, or select all of Beijing."),
    "film": ("你想了解哪部电影？可以输入片名，或选择下方候选。", "Which film do you mean? Enter a title or choose one of the candidates below."),
    "ambiguous_film": ("有多部影片符合这个名称，请选择一部后继续。", "More than one film matches that name. Please choose a film to continue."),
    "unknown_film": ("平台未找到这部影片，无法确认它的片长或场次。请核对片名；我不会自动换片。", "This film was not found in the platform catalog, so its details and screenings are unknown. Please check the title; I will not switch films automatically."),
    "outside": ("当前地区暂无影院和场次（本平台暂仅覆盖北京市）。你可以主动选择北京全市或北京的具体行政区。", "No cinemas or screenings are available in the current city. This platform covers Beijing only. You can explicitly switch to Beijing or a Beijing district."),
    "no_results": ("没有符合全部条件且能容纳整组的未来场次。可以调整日期、区域或厅型；在你确认前，我会保留原条件。", "No future screening matches all your conditions with seats for the whole group. You can change the date, district or hall type; I will retain your conditions until you do."),
    "results": ("已按整组连座、偏好分区和开场时间排序。以下均为参考方案，尚未占座；点击后将重新检查座位和价格。", "Results are ranked by seats together, preferred zone and start time. These are suggestions, not reservations; opening a card rechecks seats and prices."),
    "no_cinemas": ("没有找到符合条件的影院，请核对影院名称或区域。", "No cinema matches those conditions. Please check the name or district."),
    "no_rating": ("暂无评分", "No ratings yet"),
    "fallback": ("AI 暂时不可用，已保留条件。你可以重试或使用普通筛选。", "The AI is temporarily unavailable. Your preferences are retained. Retry or use the ordinary filters."),
    "invalid_output": ("AI 返回的条件无法验证，已保留原条件。请换一种说法，或使用普通筛选。", "The AI response could not be validated. Your original preferences are retained. Rephrase or use the ordinary filters."),
    "invalid_input": ("输入格式不正确。消息需为 1–2000 字符，人数为 1–12，时间使用 HH:MM。", "Invalid input. Messages must contain 1–2000 characters, party size 1–12, and times must use HH:MM."),
    "busy": ("上一条消息仍在处理中，请稍后再试。", "Your previous message is still being processed. Please try again shortly."),
    "csrf": ("页面会话已更新，请刷新后重试。", "Your page session has changed. Refresh the page and try again."),
    "not_found": ("该场次不存在。", "This screening does not exist."),
}


def tr(key, locale):
    return TEXT[key][0 if locale == "zh" else 1]
