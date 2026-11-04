"""Read-only dispatch, facts, permissions and server-owned candidate references."""
import re
import secrets
from .catalog import DISTRICTS
from .conversation import merge_filters, record_conditions, RULES
from .condition_policy import generic_film_request, normalize_query, rating_is_hard, without_rating, chosen_recovery, SOFT_FIELDS
from .domain import FilterPatch, Filters
from .messages import tr
from .tool_types import DEFINITIONS
from .localization import private_card_labels


class ToolError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


class BusinessTools:
    def __init__(self, catalog, conversation, locale, clock, actor=None, message=""):
        self.catalog, self.conversation, self.locale, self.clock, self.actor = catalog, conversation, locale, clock, actor
        self.message = message
        self.turn_updates = {}
        self.task_started = False
        self.policy_notes = []
        self.recovering = False
        self.authorized_recovery = False

    def text(self, zh, en):
        return zh if self.locale == "zh" else en

    def result(self, reply, **data):
        return {"status": "ok", "reply": reply, **data}

    def pick(self, kind, index):
        values = self.conversation.candidates.get(kind, [])
        if index is None or not 1 <= index <= len(values):
            raise ToolError("unknown_reference", self.text("请先查询候选，再选择列表中有效的序号。", "Please search first, then choose a valid number from the results."))
        return values[index - 1]

    def remember(self, kind, values):
        self.conversation.candidates[kind] = values[:3]
        self.conversation.last_task = kind
        return values[:3]

    def patch(self, args):
        args = normalize_query(args, self.message) if not self.recovering else args
        if args.task_action == "new" and not self.task_started:
            if not args.task_text or args.task_text not in self.message:
                raise ValueError("A new task needs quoted user evidence")
            self.conversation.new_task(self.clock().date())
        self.task_started = True
        self.conversation.task_action = args.task_action
        old = self.conversation.filters
        changes = args.updates.model_dump(exclude_unset=True)
        current = merge_filters(old, args.updates, self.clock().date())
        normalized = {k: getattr(current, k) for k in changes}
        # A later tool may add necessary constraints, but cannot undo a condition set this turn.
        if any(k in self.turn_updates and self.turn_updates[k] != v for k, v in normalized.items()):
            raise ToolError("constraint_change", self.text("这一轮查询不能自行更改已确认条件；请明确告诉我需要调整什么。", "A query cannot change confirmed conditions on its own. Please say which condition you want to change."))
        for key, value in changes.items():
            info = self.conversation.conditions.get(key, {})
            previous = getattr(old, key)
            removing = previous not in (None, False) and (value is None or value is False)
            widening = key == "min_rating" and previous is not None and value is not None and value < previous or key == "budget_minor" and previous is not None and value is not None and value > previous
            # Changing the city necessarily invalidates the old city's district.
            # This is a dependent update, not consent to switch back to Beijing.
            if key == "district" and changes.get("city") and changes["city"] != old.city:
                continue
            if (removing or widening) and info.get("strength") == "hard" and not self.recovering:
                explicit = any(e.field == key and e.source == "user_explicit" for e in args.evidence)
                if not explicit or args.task_action not in {"modify", "relax"}:
                    raise ToolError("constraint_change", self.text("这个条件是之前的硬限制，请明确选择取消或修改它。", "That is an existing hard requirement. Please explicitly choose to remove or change it."))
        self.turn_updates.update(normalized)
        if args.clarification == "time":
            current = current.model_copy(update={k: getattr(old, k) for k in ("date", "time_start", "time_end")})
        self.conversation.filters = current
        if changes:
            record_conditions(self.conversation, old, changes, self.message, args.evidence,
                              manual=self.recovering)
        if args.clarification:
            return self.result(tr(args.clarification, self.locale), status="needs_clarification")

    def apply_relaxation(self, changes, explicit=True):
        old = self.conversation.filters
        self.conversation.filters = merge_filters(old, FilterPatch.model_validate(changes), self.clock().date())
        record_conditions(self.conversation, old, changes, self.message, manual=explicit, relaxed=True)
        self.conversation.task_action = "relax"

    def soft_query(self, query, state):
        """Try preferred values first, then fall back only on explicitly soft fields.

        Shared catalog functions still enforce every hard field and their seat order.
        This is a bounded fallback policy, not a second pricing/search implementation.
        """
        self.effective_filters = state
        items = query(state)
        if items:
            return items
        soft = [k for k, v in self.conversation.conditions.items() if k in SOFT_FIELDS - {"zone", "sort_by_rating"}
                and v["strength"] == "soft" and v["status"] == "active" and getattr(state, k)]
        if not soft:
            return items
        candidate = state.model_copy(update={k: None for k in soft})
        # Region preferences must not override an explicitly selected cinema or screening.
        items = query(candidate)
        if items:
            self.effective_filters = candidate
            labels = {"district": ("区域", "district"), "hall_type": ("厅型", "hall type"),
                      "genre": ("类型", "genre"), "keyword": ("关键词", "keyword")}
            names = "、".join(self.text(*labels[k]) for k in soft)
            self.policy_notes.append(self.text(f"没有同时满足{names}偏好的结果，以下保留硬限制，展示其他选择。", f"No results meet all preferred values ({names}); alternatives retain every hard requirement."))
        return items

    def no_results(self, kind, query, reason, reply, limit=3, rating=False):
        """Generate a finite set of verified recovery choices, without applying them."""
        state = self.conversation.filters
        options = []
        if rating:
            options.extend([
                {"id": "include_unrated_movies", "label": {"zh": "不限制评分（含暂无评分）", "en": "Remove rating limit; include unrated films"}, "changes": {"min_rating": None, "rated_only": False, "sort_by_rating": False}},
                {"id": "choose_genre", "label": {"zh": "先按类型选，不限制评分", "en": "Choose a genre without a rating limit"}, "changes": {"min_rating": None, "rated_only": False, "sort_by_rating": False}, "ask_genre": True}])
        else:
            # Probe one constraint at a time. Never offer an invented budget or location.
            for key, zh, en in [("genre", "类型", "genre"), ("hall_type", "厅型", "hall type"),
                                ("district", "区域", "district"), ("budget_minor", "预算", "budget"),
                                ("keyword", "关键词", "keyword")]:
                if getattr(state, key) is None:
                    continue
                changes = {key: None}
                if key == "budget_minor":
                    changes["budget_scope"] = None
                candidate = merge_filters(state, FilterPatch.model_validate(changes), self.clock().date())
                if query(candidate):
                    options.append({"id": "remove_" + key, "label": {"zh": f"取消{zh}限制后重查", "en": f"Remove {en} requirement and retry"}, "changes": changes})
                if len(options) == 3:
                    break
        options.append({"id": "keep_requirements", "label": {"zh": "保留要求，暂不推荐", "en": "Keep requirements; pause recommendations"}, "changes": {}})
        recovery = {"token": secrets.token_urlsafe(16), "kind": kind, "reason": reason,
                    "filters": state.model_dump(), "limit": limit, "options": options, "reply": reply, "locale": self.locale}
        notes = list(self.policy_notes)
        if kind == "films" and state.recent:
            notes.append(self.recent_note())
        if notes:
            recovery["reply"] += "\n" + "\n".join(notes)
        self.conversation.recovery = recovery
        return self.recovery_result(recovery)

    def recovery_result(self, recovery):
        reply = recovery["reply"]
        if recovery.get("locale", self.locale) != self.locale:
            # Language changes preserve the pending choice and its hard constraints.
            replies = {
                "no_rated_movies": ("符合条件的电影目前都暂无本站评分。请选择是否包含未评分影片，或保留要求。", "The matching films have no platform ratings yet. Choose whether to include unrated films or keep the requirement."),
                "no_movies_meet_rating_requirement": ("暂无影片满足当前评分要求。请选择是否放宽评分限制，或保留要求。", "No films meet the current rating requirement. Choose whether to relax the rating limit or keep it."),
                "no_matching_films": ("暂无符合当前条件的影片。可以选择下方调整方案，或保留要求。", "No films match the current conditions. Choose an adjustment below or keep the requirements."),
            }
            reply = self.text(*replies[recovery["reason"]]) if recovery["reason"] in replies else tr("outside" if recovery["reason"] == "outside_service_area" else "no_results", self.locale)
            if recovery["kind"] == "films" and recovery["filters"].get("recent"):
                reply += "\n" + self.recent_note()
        return self.result(reply, status="needs_clarification", intent="film_recommend" if recovery["kind"] == "films" else "recommend",
            films=[], cards=[], total=0, reason=recovery["reason"], active_filters=recovery["filters"],
            recovery={"token": recovery["token"], "options": [{"id": o["id"], "label": o["label"]} for o in recovery["options"]]})

    def recent_note(self):
        return self.text("当前目录没有上映日期；这里的‘近期’仅指未来 14 天有可售排片，不代表近期首映，也不是全网榜单。", "Release dates are not recorded. Here 'recent' means saleable listings within the next 14 days, not recent releases or a web-wide ranking.")

    def recover_search(self, args):
        recovery = self.conversation.recovery
        if not recovery or recovery["token"] != args.token or recovery["filters"] != self.conversation.filters.model_dump():
            raise ToolError("stale_recovery", self.text("筛选条件已变化，请按当前条件重新查询。", "Conditions changed. Please search again with your current requirements."))
        option = next((o for o in recovery["options"] if o["id"] == args.option_id), None)
        if not option:
            raise ValueError("Unknown recovery option")
        if not self.authorized_recovery and chosen_recovery(self.message, recovery) != args.option_id:
            return self.recovery_result(recovery)
        if self.authorized_recovery:
            self.message = option["label"][self.locale]
        if option["id"] == "keep_requirements":
            self.conversation.recovery = None
            return self.result(self.text("已保留要求，暂时不推荐。之后可以明确告诉我想调整哪项条件。", "Requirements kept; recommendations paused. Tell me which condition to change when ready."), films=[], cards=[])
        self.apply_relaxation(option["changes"])
        if option.get("ask_genre"):
            return self.result(self.text("已取消评分限制。你想看什么类型，例如科幻、喜剧或悬疑？", "Rating requirement removed. Which genre would you like, such as science fiction, comedy or mystery?"), status="needs_clarification", films=[], cards=[])
        self.recovering = True
        from .tool_types import FilmQuery, ScreeningQuery
        result = self.search_films(FilmQuery(limit=recovery["limit"], task_action="relax")) if recovery["kind"] == "films" else self.search_screenings(ScreeningQuery(task_action="relax"))
        prefix = self.text("已按你的选择调整条件，并重新查询当前数据。", "Your selected condition has been changed and current data rechecked.")
        if result["status"] == "ok":
            count = len(result.get("films", []) or result.get("cards", []))
            result["reply"] = prefix + self.text(f"找到 {count} 个候选，详情见下方卡片；暂无评分不代表高分，推荐不会占座。", f" Found {count} options; see the cards below. Unrated does not mean highly rated, and recommendations do not reserve seats.")
        else:
            result["reply"] = prefix + "\n" + result["reply"]
        return result

    def select_film(self, index):
        film = self.pick("films", index)
        old = self.conversation.filters
        self.conversation.filters = self.conversation.filters.model_copy(update={"film_id": int(film["id"]), "film_query": film["title"], "screening_id": None})
        record_conditions(self.conversation, old, {"film_id": film["id"], "film_query": film["title"]}, self.message, manual=True)

    def execute(self, name, arguments):
        if name not in DEFINITIONS:
            raise ToolError("unknown_tool", self.text("这个操作不在助手可用的查询工具中。", "That operation is not an available read tool."))
        args = DEFINITIONS[name][0].model_validate(arguments)
        # Dispatch only fixed Python methods. No import/eval, SQL or URLs from the model.
        return getattr(self, name)(args)

    def search_films(self, args):
        if generic_film_request(self.message) and not self.recovering:
            # Generic discovery adds no new hard preference, even if a model volunteers one.
            args = args.model_copy(update={"updates": FilterPatch(), "evidence": [], "task_action": "continue", "limit": 1 if re.search(r"一部|一个|\b(?:a|one|any)\b", self.message) else args.limit})
            pending = self.conversation.recovery
            if pending and pending["kind"] == "films":
                if pending["reason"] in {"no_rated_movies", "no_movies_meet_rating_requirement"} and not rating_is_hard(self.conversation):
                    self.apply_relaxation({"min_rating": None, "rated_only": False, "sort_by_rating": False}, explicit=False)
                    args = args.model_copy(update={"task_action": "relax"})
                    self.policy_notes.append(self.text("上次无法按评分推荐；这次已放下评分偏好，包含暂无评分的影片。", "The previous search could not rank by ratings; this recommendation relaxes that preference and includes unrated films."))
                else:
                    return self.recovery_result(pending)
        pending = self.patch(args)
        if pending:
            return pending
        if args.film_index:
            self.select_film(args.film_index)
        state = self.conversation.filters
        self.conversation.task_kind = "films"
        if args.detail:
            matched = self.catalog.find_films(state.film_query)
            if state.film_id:
                matched = [f for f in matched if f.id == state.film_id]
            if not state.film_query or len(matched) != 1:
                films = self.remember("films", [self.catalog.film_data(f, self.locale) for f in matched[:3]])
                key = "film" if not state.film_query else "ambiguous_film" if matched else "unknown_film"
                return self.result(tr(key, self.locale), status="needs_clarification", films=films, intent="film")
            films = [self.catalog.film_data(matched[0], self.locale)]
        else:
            query = lambda f: self.catalog.discover_films(f, self.locale, args.limit)
            films = self.soft_query(query, state)
            # A soft rating preference ranks known scores, never invents a numeric gate.
            if state.sort_by_rating and not state.min_rating and not state.rated_only:
                rated = [f for f in films if f["rating_count"] and f["rating"] is not None]
                if rated:
                    films = rated
                elif films:
                    total = len(self.catalog.discover_films(without_rating(self.effective_filters), self.locale, limit=None))
                    self.remember("films", [])
                    return self.no_results("films", query, "no_rated_movies",
                        self.text(f"符合其他条件的 {total} 部电影目前都暂无本站评分，无法按本站评分推荐。可以选择包含未评分影片，或保留要求。", f"All {total} films matching the other conditions have no platform ratings yet. Choose whether to include unrated films or keep the requirement."), args.limit, rating=True)
            if not films:
                self.remember("films", [])
                rating_blocked = bool((state.min_rating is not None or state.rated_only) and query(without_rating(state)))
                return self.no_results("films", query, "no_movies_meet_rating_requirement" if rating_blocked else "no_matching_films",
                    self.text("暂无影片满足当前评分要求；要包含未评分或较低评分的影片，需要你选择放宽评分限制。" if rating_blocked else "暂无符合当前条件的影片。可以选择下方调整方案，或保留要求。",
                              "No films meet the rating requirement. Choose whether to remove it and include lower-rated or unrated films." if rating_blocked else "No films match the current conditions. Choose an adjustment below or keep the requirements."), args.limit, rating=rating_blocked)
        self.conversation.recovery = None
        self.remember("films", films)
        lines = []
        for i, f in enumerate(films, 1):
            rating = f'{f["rating"]}/10 ({f["rating_count"]})' if f["rating_count"] else tr("no_rating", self.locale)
            lines.append(f'{i}. {f["title"]} · {f["duration_minutes"]} {self.text("分钟", "min")} · {rating}\n{f["synopsis"]}')
        reply = "\n\n".join(lines) or self.text("本站暂无符合这些条件的影片。没有评分的影片不能列作高分电影；可以调整类型或评分条件。", "No platform films match these conditions. Unrated films cannot be called highly rated; you can change genre or rating preferences.")
        notes = self.policy_notes + [self.text("评分来自本站，满分 10 分，并列出评分人数。", "Scores are platform ratings out of 10, with vote counts.")]
        if state.recent:
            notes.append(self.recent_note())
        return self.result(reply + "\n" + " ".join(notes), films=films, notes=notes, intent="film" if args.detail else "film_recommend")

    def search_screenings(self, args):
        pending = self.patch(args)
        if pending:
            return pending
        if args.film_index:
            self.select_film(args.film_index)
        if args.cinema_index:
            cinema = self.pick("cinemas", args.cinema_index)
            old = self.conversation.filters
            self.conversation.filters = self.conversation.filters.model_copy(update={"cinema_id": int(cinema["id"])})
            record_conditions(self.conversation, old, {"cinema_id": int(cinema["id"])}, self.message, manual=True)
        if args.screening_index:
            card = self.pick("cards", args.screening_index)
            old = self.conversation.filters
            # Selecting a concrete result is explicit; keep its date and identity.
            self.conversation.filters = self.conversation.filters.model_copy(update={
                "screening_id": int(card["screening_id"]), "film_id": int(card["film"]["id"]),
                "film_query": card["film"]["title"], "cinema_id": int(card["cinema"]["id"]),
                "date": card["starts_at"][:10]})
            record_conditions(self.conversation, old, {"screening_id": int(card["screening_id"])}, self.message, manual=True)
        state = self.conversation.filters
        self.conversation.task_kind = "screenings"
        if state.city != "beijing":
            self.remember("cards", [])
            return self.no_results("cards", lambda _: [], "outside_service_area", tr("outside", self.locale))
        films = self.catalog.find_films(state.film_query)
        if state.film_query and not state.film_id and len(films) != 1:
            values = self.remember("films", [self.catalog.film_data(f, self.locale) for f in films[:3]])
            return self.result(tr("ambiguous_film" if films else "unknown_film", self.locale), status="needs_clarification", films=values)
        if state.budget_minor is not None and state.budget_scope is None:
            return self.result(self.text("这个预算是每人还是整单？票种未指定时按普通票、优惠前计算。", "Is that budget per person or for the group? Unspecified ticket types use regular fares before coupons."), status="needs_clarification")
        if state.party_size is None:
            film = next((f for f in films if f.id == state.film_id), None)
            title = film.titles[self.locale] if film else state.film_query
            selected = self.text(f"已选中《{title}》。", f"Selected {title}. ") if state.film_id else ""
            return self.result(selected + tr("party_size", self.locale), status="needs_clarification", intent="recommend")
        query = lambda f: self.catalog.recommend(f, self.locale)
        cards = self.remember("cards", self.soft_query(query, state))
        if not cards:
            rating_blocked = bool((state.min_rating is not None or state.rated_only) and query(without_rating(state)))
            return self.no_results("cards", query, "no_movies_meet_rating_requirement" if rating_blocked else "no_matching_screenings", tr("no_results", self.locale), rating=rating_blocked)
        self.conversation.recovery = None
        reply = tr("results" if cards else "no_results", self.locale)
        facts = {}
        if any(not c["contiguous"] for c in cards):
            facts["split"] = self.text("部分场次需要分开坐，已在卡片中标明。", "Some options require split seating, as marked on their cards.")
        if any("preferred_zone" in c["unmet_preferences"] for c in cards):
            facts["zone"] = self.text("部分方案未完全满足分区偏好；整组连座仍然优先。", "Some options do not fully meet the zone preference; keeping the group together takes priority.")
        notes = self.policy_notes + list(facts.values())
        if state.budget_minor is not None:
            notes.append(self.text("预算按已选票种、优惠前参考票价筛选；最终金额在订票页确认。", "Budget uses the selected fare type before coupons; confirm the final amount on the booking page."))
        return self.result(reply + (" " + " ".join(notes) if notes else ""), cards=cards, notes=notes, facts=facts, intent="recommend")

    def search_cinemas(self, args):
        pending = self.patch(args)
        if pending:
            return pending
        if args.film_index:
            self.select_film(args.film_index)
        state = self.conversation.filters
        self.conversation.task_kind = "cinemas"
        def query(filters):
            return [] if filters.city != "beijing" else [self.catalog.cinema_data(c, self.locale) for c in self.catalog.repository.cinemas()
                if (not filters.district or c.district == filters.district) and (not args.name or any(args.name.lower() in n.lower() for n in c.names.values()))]
        values = self.soft_query(query, state)
        if state.film_query or state.film_id:
            film_ids = {f.id for f in self.catalog.find_films(state.film_query) if not state.film_id or f.id == state.film_id}
            values = [c for c in values if self.cinema_has_film(c["id"], film_ids)]
        values = self.remember("cinemas", values[:3])
        reply = "\n".join(f'{i}. {c["name"]} · {c["address"]}' for i, c in enumerate(values, 1)) or tr("no_cinemas", self.locale)
        return self.result(reply, cinemas=values, intent="cinema", notes=self.policy_notes)

    def cinema_has_film(self, cid, film_ids):
        if not film_ids:
            return False
        if self.catalog.repository.source_name == "backend":
            from cinema.core import db, one, in_ids, now
            with db().connect() as c:
                return bool(one(c, f"SELECT id FROM screenings WHERE cinema_id=:c AND film_id IN ({in_ids(film_ids)}) AND status='PUBLISHED' AND starts_at>:n LIMIT 1", c=cid, n=now()))
        return any(s.cinema_id == cid and s.film_id in film_ids and s.status == "published" and s.starts_at > self.clock() for s in self.catalog.repository.screenings())

    def get_rules(self, args):
        if self.conversation.task_kind != "rules":
            self.conversation.new_task(self.clock().date(), "rules")
        topics = list(RULES["topics"]) if args.topic == "all" else [args.topic]
        facts = [{"topic": t, "text": RULES["topics"][t][self.locale], "version": RULES["version"]} for t in topics]
        return self.result("\n\n".join(f["text"] for f in facts), rules=facts, intent="rules")

    def customer(self):
        if not self.actor or self.actor.get("role") != "CUSTOMER":
            raise ToolError("login_required", self.text("请先登录顾客账号，再查询本人的订单、优惠券或费用预览。", "Sign in as a customer to view your own orders, coupons or price previews."))
        if self.catalog.repository.source_name != "backend":
            raise ToolError("backend_required", self.text("此功能需要连接正式业务后端。", "This feature requires the business backend."))
        from cinema import assistant_reads
        return assistant_reads

    def get_my_orders(self, args):
        values = self.remember("orders", private_card_labels(self.customer().orders(self.actor, args.status)))
        return self.result(self.text("已查询当前登录账号的最近订单，详情见下方卡片。" if values else "当前账号没有符合条件的订单。", "Your recent orders are shown below." if values else "No matching orders belong to this account."), orders=values, intent="orders", private=True)

    def get_my_coupons(self, args):
        reader = self.customer()
        sid = int(self.pick("cards", args.screening_index)["screening_id"]) if args.screening_index else None
        values = self.remember("coupons", private_card_labels(reader.coupons(self.actor, sid)))
        return self.result(self.text("已查询本人的优惠券；未选场次时仅显示状态，适用影院须在选定场次后校验。" if values else "当前账号没有优惠券。", "Your coupons are shown below. Without a selected screening, cinema applicability has not been checked." if values else "You have no coupons."), coupons=values, intent="coupons", private=True)

    def check_reschedule(self, args):
        reader = self.customer()
        order = self.pick("orders", args.order_index)
        value = reader.reschedule(self.actor, int(order["id"]))
        cards = []
        if value["eligible"] and args.date:
            state = merge_filters(self.conversation.filters, FilterPatch(date=args.date), self.clock().date())
            # Original film/cinema/party are required by the business rule, not a model preference.
            state = Filters(date=state.date, film_id=int(value["film_id"]), cinema_id=int(value["cinema_id"]), party_size=value["party_size"])
            cards = [c for c in self.catalog.recommend(state, self.locale, limit=4) if int(c["screening_id"]) != int(value["screening_id"])][:3]
            self.remember("cards", cards)
        reply = self.text("该订单当前可申请同影院、同影片整单改签。费用仅供预览，请在原页面确认。" if value["eligible"] else "该订单当前不满足改签条件：已失效，或距离开场不足 30 分钟。", "This booking is currently eligible for a whole-party change at the same cinema for the same film. Confirm fees on the booking page." if value["eligible"] else "This booking cannot be changed: it is inactive or starts in under 30 minutes.")
        return self.result(reply, reschedule=value, cards=cards, intent="reschedule", private=True)

    def preview_price(self, args):
        reader = self.customer()
        if args.order_index is None and (args.regular_count is None or args.student_count is None):
            return self.result(self.text("请确认普通票和学生票各几张；不使用的票种填 0。", "How many regular and student tickets? Use zero for an unused type."), status="needs_clarification")
        card = self.pick("cards", args.screening_index)
        cp = int(self.pick("coupons", args.coupon_index)["id"]) if args.coupon_index else None
        source = int(self.pick("orders", args.order_index)["id"]) if args.order_index else None
        value = reader.preview(self.actor, int(card["screening_id"]), args.regular_count, args.student_count, cp, source,
            {"front": "FRONT", "middle": "MIDDLE", "back": "REAR"}.get(self.conversation.filters.zone))
        return self.result(self.text("费用预览已生成，未占座、未核销优惠券、未创建订单。最终金额请在订票或改签页面确认。", "Price preview only. No seats are held, coupons consumed or orders created. Confirm the final amount on the booking/change page."), previews=[value], intent="price", private=True)

    def resolve_location(self, args):
        from flask import current_app, has_app_context
        maps_available = has_app_context() and current_app.config.get("AMAP_JS_KEY") and current_app.config.get("AMAP_SECURITY_CODE")
        if args.nearest and maps_available:
            return self.result(self.text("请打开下方影院地图，再点击定位并授权。地图将按直线距离排序已填写坐标的影院；缺少坐标时不会猜测距离。位置不发送给 AI，聊天中的筛选条件保持不变。", "Open the cinema map below, then choose Use my location and allow permission. Cinemas with coordinates can be sorted by straight-line distance; missing positions are not guessed. Location is not sent to the AI and your chat filters stay unchanged."),
                status="needs_clarification", intent="location", location={"action": "open_cinema_map", "distance_available": False})
        if args.place:
            value = args.place.lower().strip()
            code = next((k for k, names in DISTRICTS.items() if value in (k, names[0], names[0][:-1], names[1].lower())), None)
            if code is None:
                matches = [c for c in self.catalog.repository.cinemas() if any(value in a.lower() for a in (*c.address.values(), *c.names.values()))]
                districts = {c.district for c in matches}
                code = next(iter(districts)) if len(districts) == 1 else None
            if code:
                old = self.conversation.filters
                self.conversation.filters = merge_filters(self.conversation.filters, FilterPatch(district=code), self.clock().date())
                record_conditions(self.conversation, old, {"district": code}, self.message, manual=True)
                note = self.text("已确认区域。当前只有区级信息，不能判断哪家离你最近。", "District confirmed. District-level information cannot determine the nearest cinema.")
                return self.result(note, location={"district": code, "precision": "district", "distance_available": False}, intent="location")
        if maps_available:
            return self.result(self.text("可手动提供北京行政区，或在影院地图中点击定位。聊天无法读取设备位置，也不会猜测距离。", "Provide a Beijing district, or choose Use my location on the cinema map. Chat cannot read device location or guess distances."),
                status="needs_clarification", intent="location", location={"action": "open_cinema_map", "distance_available": False})
        return self.result(self.text("请手动提供北京行政区或平台影院地址。当前未配置地图服务，不能获取设备位置、解析任意地标或计算最近距离。", "Please provide a Beijing district or a catalog cinema address. Maps are not configured; device location, arbitrary landmarks and nearest-distance calculations are unavailable."), status="needs_clarification", intent="location")
