'use strict';
const $ = (id) => document.getElementById(id);
const words = {
  zh: {
    language_hint: '回复自动跟随提问语言，历史消息保留原文。', dolby: '杜比影院', imax: 'IMAX', close: '关闭预览', send: '发送',
    beijing: '北京 · 观影指南', headline: '好电影，好座位。', intro: '告诉我们你的观影计划，把今晚留给大银幕。', intro_note: '从一句想法\n到一场好电影',
    assistant_title: '你的观影助手', new_chat: '新对话 ↗', welcome_title: '想看什么？一起挑一场。', welcome_copy: '选片、找连座、问规则。说说你的想法，我来帮你缩小选择。',
    example_recommend: '明天朝阳区，三人看电影 A', example_film: '《星海来信》讲了什么？', example_student: '学生票有什么要求？', thinking: '正在理解你的想法、核对场次…',
    message_label: '输入观影需求', message_placeholder: '例如：今晚朝阳区三个人看电影 A，尽量坐中间', composer_note: '推荐不占座 · 价格以正式订票页为准',
    your_plan: '安排你的观影时光', search_title: '自己挑，也很好。', search_copy: '用条件直接找场次，随时可用。', district: '区域', film: '影片', date: '日期', people: '人数', hall: '厅型',
    seat_zone: '座位分区', any: '不限', standard: '普通厅', front: '前区', middle: '中区', back: '后区', from: '开场不早于', until: '开场早于', find_screenings: '查找场次',
    search_note: '连座优先，再考虑偏好位置。\n仅显示能容纳整组的可售场次。', preview_eyebrow: '座位详情', preview_note: '只读预览，不占座、不付款。正式选座与购票功能由订票模块提供。',
    all_districts: '北京全市', all_films: '全部影片', demo: '离线演示 · 规则解析', deepseek: 'DeepSeek · AI 对话', mock_data: '演示数据 · 影片、影院与评分均为虚构', live_data: '平台目录数据',
    assistant: 'FALCONS 助手', you: '你', search_name: '普通筛选', together: '整组连座', split: '需要分开坐', zone_missed: '未完全满足分区偏好', regular: '普通票', student: '学生票', each: '/ 人',
    preview: '查看座位 ↗', seats: '建议座位', no_rating: '暂无评分', minutes: '分钟', checked: '已重新查询', available: '可选', sold: '已售', held: '暂时占用', suggested: '原建议仍可选',
    screen: '银幕', row: '排', seat: '座', cancelled: '此场次已取消、未发布或已开场，不能继续订票。', changed: '部分建议座位已不可选，请根据最新座位图重新选择。',
    price_changed: '参考票价已变化，请以本次查询显示的价格为准。', loading_preview: '正在重新检查座位与价格…', network: '连接失败，请稍后重试。普通筛选也可用于查询。',
    reset_done: '已开始新对话。', people_suffix: '人', before_coupons: '参考单价，未计算优惠券', filters_unknown: '人数待确认', model_error: 'AI 暂不可用，可重试或使用右侧筛选。',
    authentication: '模型密钥验证失败，请检查后端配置。', missing_key: '尚未配置 DeepSeek 密钥，可先使用普通筛选。', quota: 'DeepSeek 账户额度不足，可先使用普通筛选。',
    rate_limit: '模型请求繁忙，请稍后重试。', timeout: '模型响应超时，已保留当前条件。', invalid_output: '模型响应未通过校验，原条件已保留。',
  },
  en: {
    language_hint: "Replies follow your question's language. Earlier messages keep their original language.", dolby: 'Dolby Cinema', imax: 'IMAX', close: 'Close preview', send: 'Send',
    beijing: 'BEIJING · CINEMA GUIDE', headline: 'Great stories. Better seats.', intro: 'Tell us your plans. Save tonight for the big screen.', intro_note: 'From a little idea\nto a great movie night',
    assistant_title: 'Your cinema companion', new_chat: 'New chat ↗', welcome_title: 'What are you in the mood for?', welcome_copy: 'Find a film, sit together, get the details. Share a little of your plan and we’ll narrow it down.',
    example_recommend: 'Movie A, three people, Chaoyang tomorrow', example_film: 'What is Letters from the Stars about?', example_student: 'What are the student ticket requirements?', thinking: 'Understanding your plans and checking screenings…',
    message_label: 'Your cinema plans', message_placeholder: 'Try: Movie A in Chaoyang tonight, three people, middle seats', composer_note: 'Suggestions don’t reserve seats · Final prices at booking',
    your_plan: 'MAKE IT YOUR NIGHT', search_title: 'Pick your own path.', search_copy: 'Find screenings with filters. Always available.', district: 'District', film: 'Film', date: 'Date', people: 'People', hall: 'Hall',
    seat_zone: 'Seating zone', any: 'Any', standard: 'Standard', front: 'Front', middle: 'Middle', back: 'Back', from: 'Starts from', until: 'Starts before', find_screenings: 'Find screenings',
    search_note: 'Seats together first, preferred zone next.\nOnly options with space for your whole group.', preview_eyebrow: 'A CLOSER LOOK', preview_note: 'Read-only preview. No seats are held and no payment is made. Seat selection and checkout belong to the booking module.',
    all_districts: 'All of Beijing', all_films: 'All films', demo: 'Offline demo · Rule-based parser', deepseek: 'DeepSeek · AI conversation', mock_data: 'Demo data · Fictional films, cinemas and ratings', live_data: 'Platform catalog data',
    assistant: 'FALCONS ASSISTANT', you: 'YOU', search_name: 'FILTER SEARCH', together: 'Seats together', split: 'Split seating', zone_missed: 'Zone preference not fully met', regular: 'Regular', student: 'Student', each: '/ person',
    preview: 'View seats ↗', seats: 'Suggested seats', no_rating: 'No ratings yet', minutes: 'min', checked: 'Rechecked', available: 'Available', sold: 'Sold', held: 'On hold', suggested: 'Suggestion still available',
    screen: 'SCREEN', row: 'Row', seat: 'Seat', cancelled: 'This screening is cancelled, unpublished or has started. Booking is unavailable.', changed: 'Some suggested seats are no longer available. Please check the latest seating map.',
    price_changed: 'Reference fares have changed. The latest fares are shown below.', loading_preview: 'Rechecking seats and prices…', network: 'Connection failed. Please try again. You can also use the ordinary filters.',
    reset_done: 'A fresh conversation is ready.', people_suffix: 'people', before_coupons: 'Reference fare per ticket, before coupons', filters_unknown: 'Party size not set', model_error: 'AI is unavailable. Retry or use the filters.',
    authentication: 'Model authentication failed. Check the server configuration.', missing_key: 'DeepSeek is not configured yet. You can still use the filters.', quota: 'The DeepSeek account has insufficient credit. Filters remain available.',
    rate_limit: 'The model is busy. Please retry shortly.', timeout: 'The model timed out. Your preferences are retained.', invalid_output: 'The model response could not be validated. Original preferences are retained.',
  },
};
let language = 'zh';
try { language = localStorage.getItem('falcons-language') === 'en' ? 'en' : 'zh'; } catch (_) {}
let bootstrapData;
let confirmedFilters;
let busy = false;
let previewGeneration = 0;
const responseViews = new Map();
const filmDisplay = film => ({...film, title: film.titles?.[language] || film.title, synopsis: film.synopses?.[language] || film.synopsis});
const cinemaDisplay = cinema => ({...cinema, name: cinema.names?.[language] || cinema.name});
const t = (key) => words[language][key] || key;
// Match the server's reply_locale; the standalone app also runs without the main site's assets.
function replyLanguage(message, previous) {
  const text = message.trim();
  if (/^(?:please\s+)?(?:what|where|when|how|which|can you|could you|would you|show|recommend|find|list|tell me|check)\b/i.test(text)) return 'en';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[A-Za-z]/.test(text)) return 'en';
  return previous === 'en' ? 'en' : 'zh';
}
function followLanguage(next) {
  if (next !== 'zh' && next !== 'en') return;
  language = next;
  try { localStorage.setItem('falcons-language', language); } catch (_) {}
  setLanguage();
}
const examples = {
  zh: { recommend: '明天朝阳区三个人看电影 A，尽量坐中间', film: '《星海来信》讲了什么？', student: '学生票有什么要求？' },
  en: { recommend: 'Movie A in Chaoyang tomorrow, three people, middle seats', film: 'What is Letters from the Stars about?', student: 'What are the student ticket requirements?' },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function setLanguage() {
  if (bootstrapData?.data_source === 'backend') {
    const title = bootstrapData.films[0]?.titles[language];
    examples[language].recommend = language === 'zh' ? '明天三个人看电影，尽量坐中间' : 'Recommend screenings tomorrow for three people, middle seats';
    examples[language].film = title ? (language === 'zh' ? `《${title}》讲了什么？` : `What is "${title}" about?`) : (language === 'zh' ? '有哪些电影？' : 'Recommend films');
    words[language].example_recommend = examples[language].recommend;
    words[language].example_film = examples[language].film;
    words[language].message_placeholder = examples[language].recommend;
  }
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  const headline = document.querySelector('[data-i18n="headline"]');
  headline.replaceChildren(document.createTextNode(language === 'zh' ? '好电影，' : 'Great stories. '), element('em', '', language === 'zh' ? '好座位。' : 'Better seats.'));
  document.querySelectorAll('[data-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.placeholder); });
  $('send').setAttribute('aria-label', t('send'));
  $('close-preview').setAttribute('aria-label', t('close'));
  $('conditions').setAttribute('aria-label', language === 'zh' ? '本次筛选条件' : 'Current search conditions');
  document.querySelectorAll('[data-message-role]').forEach(node => {
    node.querySelector('.message-header').textContent = t(node.dataset.messageRole === 'user' ? 'you' : node.dataset.messageRole === 'system' ? 'search_name' : 'assistant');
  });
  for (const [node, value] of responseViews) {
    if (node.isConnected) renderResponse(value.data, value.isSearch, node);
    else responseViews.delete(node);
  }
  if (bootstrapData) {
    $('mode-label').textContent = t(bootstrapData.provider === 'stub' ? 'demo' : 'deepseek');
    $('data-note').textContent = t(bootstrapData.data_source === 'mock' ? 'mock_data' : 'live_data');
    const district = $('district').value;
    const filmId = $('film_query').selectedOptions[0]?.dataset.filmId;
    $('district').replaceChildren(new Option(t('all_districts'), ''));
    bootstrapData.districts.forEach((d) => $('district').add(new Option(d[language], d.id)));
    $('district').value = district;
    $('film_query').replaceChildren(new Option(t('all_films'), ''));
    bootstrapData.films.forEach((f) => {
      const option = new Option(f.titles[language], f.titles[language]);
      option.dataset.filmId = String(f.id);
      $('film_query').add(option);
      if (String(f.id) === filmId) option.selected = true;
    });
    renderConditions(confirmedFilters);
  }
}
function renderConditions(filters) {
  if (!filters) return;
  confirmedFilters = filters;
  const district = bootstrapData.districts.find((d) => d.id === filters.district);
  const bits = [filters.city !== 'beijing' ? filters.city : district?.[language] || t('all_districts'), filters.date];
  if (filters.time_start || filters.time_end) bits.push(`${filters.time_start || '00:00'}–${filters.time_end || '24:00'}`);
  bits.push(filters.party_size ? `${filters.party_size} ${t('people_suffix')}` : t('filters_unknown'));
  if (filters.film_query) {
    const film = bootstrapData.films.find(f => String(f.id) === String(filters.film_id) || Object.values(f.titles).includes(filters.film_query));
    bits.push(film?.titles[language] || filters.film_query);
  }
  if (filters.hall_type) bits.push(t(filters.hall_type));
  if (filters.zone) bits.push(t(filters.zone));
  $('conditions').replaceChildren(...bits.map((bit) => element('span', 'condition', bit)));
}
async function api(path, options = {}) {
  if (!/[?&]locale=/.test(path)) path += `${path.includes('?') ? '&' : '?'}locale=${language}`;
  const response = await fetch(path, { credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': bootstrapData?.csrf_token || '', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 403) await loadSession();
    throw new Error(data.error?.message || data.reply || t('network'));
  }
  return data.data ?? data;
}
function showError(message) { $('global-error').textContent = message; $('global-error').hidden = false; }
function setBusy(value) {
  busy = value;
  ['send', 'search', 'reset'].forEach((id) => { $(id).disabled = value; });
  $('loading').hidden = !value;
}
function addMessage(role, text) {
  $('welcome')?.remove();
  const node = element('article', `message ${role}`);
  node.dataset.messageRole = role;
  node.append(element('div', 'message-header', t(role === 'user' ? 'you' : role === 'system' ? 'search_name' : 'assistant')));
  const content = element('div', 'message-content', text); content.lang = language === 'zh' ? 'zh-CN' : 'en';
  node.append(content);
  $('conversation').append(node);
  scrollChat();
  return node;
}
function scrollChat() { requestAnimationFrame(() => { $('conversation').scrollTop = $('conversation').scrollHeight; }); }
function formattedDate(iso) {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
function money(cents) { return `¥${(cents / 100).toFixed(2).replace(/\.00$/, '')}`; }
function renderCards(cards, parent) {
  if (!cards?.length) return;
  const list = element('div', 'cards');
  cards.forEach((card) => {
    card = {...card, film: filmDisplay(card.film), cinema: cinemaDisplay(card.cinema)};
    const ticket = element('article', 'ticket');
    const body = element('div', 'ticket-body');
    const meta = element('div', 'ticket-meta', formattedDate(card.starts_at));
    meta.append(element('span', 'hall-badge', t(card.hall_type)));
    body.append(meta, element('h4', '', card.film.title), element('p', 'ticket-cinema', card.cinema.name));
    body.append(element('p', 'ticket-seats', `${t(card.contiguous ? 'together' : 'split')} · ${card.suggested_seats.map((s) => s.label).join(' / ')}`));
    if (card.unmet_preferences.includes('preferred_zone')) body.append(element('p', 'ticket-warning', t('zone_missed')));
    const action = element('div', 'ticket-action');
    const price = element('div', 'ticket-price', money(card.fares.regular));
    price.append(element('small', '', ` ${t('each')}`));
    const button = element('button', '', t('preview'));
    button.dataset.i18n = 'preview';
    button.type = 'button';
    button.addEventListener('click', () => openPreview(card));
    action.append(price, element('div', 'ticket-student', `${t('student')} ${money(card.fares.student)}`), button);
    action.title = t('before_coupons');
    ticket.append(body, action);
    list.append(ticket);
  });
  parent.append(list);
  scrollChat();
}
function renderResponse(data, isSearch = false, existing = null) {
  if (!existing && data.locale && data.locale !== language) followLanguage(data.locale);
  const message = existing || addMessage('assistant', data.reply || t(data.error_code || 'model_error'));
  if (existing) while (message.children.length > 2) message.lastElementChild.remove();
  else responseViews.set(message, {data, isSearch});
  if (data.recovery?.options?.length) {
    const choices = element('div', 'fact-choices');
    data.recovery.options.forEach((option) => {
      const button = element('button', '', option.label[language]);
      button.type = 'button';
      button.onclick = async () => {
        if (busy) return;
        setBusy(true); addMessage('user', option.label[language]);
        try {
          renderResponse(await api('/api/ai/recovery', { method: 'POST', body: JSON.stringify({ token: data.recovery.token, option_id: option.id, locale: language }) }));
          choices.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        } catch (error) { addMessage('assistant', error.message || t('network')); }
        finally { setBusy(false); }
      };
      choices.append(button);
    });
    message.append(choices);
  }
  renderCards(data.cards, message);
  if (data.films?.length && data.status !== 'needs_clarification') {
    const list = element('div', 'cards');
    data.films.forEach((film, i) => {
      film = filmDisplay(film);
      const item = element('article', 'ticket-body');
      item.append(element('h4', '', `${i + 1}. ${film.title}`), element('p', '', film.synopsis),
        element('p', '', film.rating_count ? `${film.rating}/10 · ${film.rating_count} ${language === 'zh' ? '人评分（本站）' : 'platform ratings'}` : t('no_rating')));
      const button = element('button', '', language === 'zh' ? '查询场次' : 'Find showtimes');
      button.type = 'button';
      button.onclick = () => sendMessage(language === 'zh' ? `查第${i + 1}部电影的场次` : `Show screenings for film number ${i + 1}`);
      item.append(button); list.append(item);
    });
    message.append(list);
  }
  if (data.orders?.length || data.coupons?.length || data.previews?.length || data.reschedule || data.status === 'login_required') {
    const note = element('p', '', language === 'zh' ? '个人结果与费用明细可在主站助手查看。' : 'View personal result cards and price details in the main website assistant.');
    const link = element('a', '', language === 'zh' ? '打开主站助手' : 'Open website assistant');
    link.href = '/#/assistant'; note.append(link); message.append(note);
  }
  if (data.status === 'needs_clarification' && data.films?.length) {
    const choices = element('div', 'fact-choices');
    data.films.forEach((film) => {
      film = filmDisplay(film);
      const button = element('button', '', film.title);
      button.type = 'button';
      button.addEventListener('click', () => {
        if (isSearch) {
          $('film_query').value = film.title;
          $('search-form').requestSubmit();
        } else sendMessage(language === 'zh' ? `《${film.title}》` : `Tell me about "${film.title}"`);
      });
      choices.append(button);
    });
    message.append(choices);
  }
  if (!isSearch && !existing) renderConditions(data.filters);
  if (!existing) scrollChat();
}
async function sendMessage(message) {
  if (busy || !message.trim() || message.length > 2000 || !bootstrapData) return;
  followLanguage(replyLanguage(message, language));
  setBusy(true);
  $('global-error').hidden = true;
  addMessage('user', message.trim());
  $('message').value = '';
  $('char-count').textContent = '0 / 2000';
  try { renderResponse(await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message, locale: language }) })); }
  catch (error) { addMessage('assistant', error.message || t('network')); }
  finally { setBusy(false); $('message').focus(); }
}
async function loadSession() {
  const response = await fetch(`/api/ai/session?locale=${language}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(t('network'));
  const result = await response.json();
  bootstrapData = result.data ?? result;
  confirmedFilters = bootstrapData.filters;
  $('date').value = bootstrapData.today;
  setLanguage();
}
async function openPreview(card) {
  const generation = ++previewGeneration;
  const content = $('preview-content');
  content.replaceChildren(element('h2', '', t('loading_preview')));
  if (!$('preview-dialog').open) $('preview-dialog').showModal();
  try {
    const data = await api(`/api/catalog/screenings/${encodeURIComponent(card.screening_id)}?locale=${language}`);
    if (generation !== previewGeneration) return;
    const title = element('h2', '', data.film.title); title.id = 'preview-title';
    content.replaceChildren(title, element('p', 'preview-meta', `${data.cinema.name} · ${formattedDate(data.starts_at)} · ${data.hall_label}`));
    content.append(element('p', 'preview-price', `${t('regular')} ${money(data.fares.regular)} · ${t('student')} ${money(data.fares.student)} · ${t('before_coupons')}`));
    const suggestedIds = new Set(card.suggested_seats.map((s) => s.id));
    const availableIds = new Set(data.seats.filter((s) => s.state === 'available').map((s) => s.id));
    const changed = [...suggestedIds].some((id) => !availableIds.has(id));
    if (!data.saleable) content.append(element('p', 'preview-alert', t('cancelled')));
    else if (changed) content.append(element('p', 'preview-alert', t('changed')));
    if (data.fares.regular !== card.fares.regular || data.fares.student !== card.fares.student) content.append(element('p', 'preview-alert', t('price_changed')));
    if (data.layout) {
      renderPhysicalMap(content, data, suggestedIds);
    } else {
    content.append(element('div', 'screen', t('screen')));
    const map = element('div', 'seat-map');
    const rows = new Map();
    data.seats.forEach((seat) => { if (!rows.has(seat.row)) rows.set(seat.row, []); rows.get(seat.row).push(seat); });
    [...rows.entries()].sort((a, b) => a[0] - b[0]).forEach(([rowNumber, seats]) => {
      seats.sort((a, b) => a.number - b.number);
      const row = element('div', 'seat-row');
      row.append(element('span', 'row-label', `${rowNumber} · ${t(seats[0].zone)}`));
      let segment;
      seats.forEach((seat) => {
        const suggested = data.saleable && suggestedIds.has(seat.id) && seat.state === 'available';
        const node = element('span', `seat ${seat.state}${suggested ? ' suggested' : ''}${segment !== undefined && seat.segment !== segment ? ' aisle' : ''}`, seat.number);
        const label = `${t('row')} ${seat.row}, ${t('seat')} ${seat.number}, ${t(seat.zone)}, ${t(suggested ? 'suggested' : seat.state)}`;
        node.setAttribute('role', 'img'); node.setAttribute('aria-label', label); node.title = label;
        segment = seat.segment;
        row.append(node);
      });
      map.append(row);
    });
    content.append(map);
    }
    const legend = element('div', 'seat-legend');
    ['available', 'sold', 'held', 'suggested'].forEach((state) => { const item = element('span', '', t(state)); item.prepend(element('i', state)); legend.append(item); });
    content.append(legend, element('p', 'preview-meta', `${t('checked')} ${formattedDate(data.checked_at)}`));
    if (bootstrapData.data_source === 'backend' && data.saleable) {
      const params = new URLSearchParams({ party_size: String(card.suggested_seats.length),
        seat_ids: card.suggested_seats.map((s) => s.id).join(','), from: 'assistant' });
      const link = element('a', 'primary-button', language === 'zh' ? '进入正式选座 →' : 'Continue to seat selection →');
      link.href = `/#/seats/${encodeURIComponent(data.screening_id)}?${params}`;
      content.append(link);
    }
  } catch (error) { if (generation === previewGeneration) content.replaceChildren(element('p', 'preview-alert', error.message || t('network'))); }
}

function renderPhysicalMap(content, data, suggestedIds) {
  const direction = data.layout.screen_direction.toLowerCase();
  const viewport = element('div', 'layout-viewport');
  const frame = element('div', `physical-layout screen-${direction}`);
  frame.append(element('div', 'physical-screen', t('screen')));
  const map = element('div', 'physical-seats');
  const xs = data.seats.map((s) => s.map_x), ys = data.seats.map((s) => s.map_y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const cell = 38;
  map.style.width = `${(Math.max(...xs) - minX + 1) * cell}px`;
  map.style.height = `${(Math.max(...ys) - minY + 1) * cell}px`;
  data.seats.forEach((seat) => {
    const suggested = data.saleable && suggestedIds.has(seat.id) && seat.state === 'available';
    const node = element('span', `seat ${seat.state}${suggested ? ' suggested' : ''}`, seat.label);
    node.style.left = `${(seat.map_x - minX) * cell}px`;
    node.style.top = `${(seat.map_y - minY) * cell}px`;
    const label = `${t('row')} ${seat.row}, ${t('seat')} ${seat.number}, ${t(seat.zone)}, ${t(suggested ? 'suggested' : seat.state)}`;
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', label); node.title = label;
    map.append(node);
  });
  frame.append(map); viewport.append(frame); content.append(viewport);
}

$('chat-form').addEventListener('submit', (event) => { event.preventDefault(); sendMessage($('message').value); });
$('message').addEventListener('input', () => { $('char-count').textContent = `${$('message').value.length} / 2000`; });
$('message').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-form').requestSubmit(); } });
document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => sendMessage(examples[language][button.dataset.example])));
$('search-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy || !bootstrapData) return;
  setBusy(true); $('global-error').hidden = true;
  const params = new URLSearchParams(new FormData(event.target)); params.set('locale', language);
  addMessage('system', `${$('date').value} · ${$('party_size').value} ${t('people_suffix')}`);
  try { renderResponse(await api(`/api/catalog/screenings?${params}`), true); } catch (error) { showError(error.message || t('network')); } finally { setBusy(false); }
});
$('reset').addEventListener('click', async () => {
  if (busy) return; setBusy(true);
  try { const result = await api('/api/ai/session', { method: 'DELETE' }); $('conversation').replaceChildren(); responseViews.clear(); renderConditions(result.filters); addMessage('assistant', t('reset_done')); }
  catch (error) { showError(error.message || t('network')); } finally { setBusy(false); }
});
$('close-preview').addEventListener('click', () => { previewGeneration++; $('preview-dialog').close(); });
$('preview-dialog').addEventListener('close', () => { previewGeneration++; });
setLanguage();
setBusy(true);
loadSession().catch(() => showError(t('network'))).finally(() => setBusy(false));
