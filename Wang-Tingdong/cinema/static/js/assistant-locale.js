// Display-only localization. Never change canonical filters, IDs or candidate order.
export function replyLanguage(message, previous = 'zh') {
  const text = message.trim();
  if (/^(?:please\s+)?(?:what|where|when|how|which|can you|could you|would you|show|recommend|find|list|tell me|check)\b/i.test(text)) return 'en';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[A-Za-z]/.test(text)) return 'en';
  return previous === 'en' ? 'en' : 'zh';
}
const genres = {
  'Science Fiction': '科幻', Comedy: '喜剧', Drama: '剧情', Adventure: '冒险', Romance: '爱情',
  Animation: '动画', Thriller: '惊悚', Mystery: '悬疑', Action: '动作', Horror: '恐怖',
  Documentary: '纪录片', Biography: '传记', Crime: '犯罪', Fantasy: '奇幻', Family: '家庭',
};
const statuses = {
  CONFIRMED: ['已确认', 'Confirmed'], RESCHEDULED: ['已改签', 'Rescheduled'],
  CINEMA_CANCELLED: ['影院已取消', 'Cancelled by cinema'], AVAILABLE: ['可用', 'Available'],
  USED: ['已使用', 'Used'], EXPIRED: ['已过期', 'Expired'], CANCELLED: ['已取消', 'Cancelled'],
  REVOKED: ['已撤销', 'Revoked'],
};
export function genreLabel(value, language) {
  const canonical = Object.keys(genres).find(key => key.toLowerCase() === value.toLowerCase() || genres[key] === value);
  return canonical ? language === 'zh' ? genres[canonical] : canonical : value;
}
export function statusLabel(value, language) {
  return statuses[value]?.[language === 'zh' ? 0 : 1] || (language === 'zh' ? '状态待确认' : 'Status unavailable');
}
export function assistantDate(value, language) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-GB', {
    timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}
export function localizeFilm(film, language) {
  return {...film, title: film.titles?.[language] || film.title,
    synopsis: film.synopses?.[language] || film.synopsis,
    genres: (film.genres || []).map(value => genreLabel(value, language))};
}
export function localizeCinema(cinema, language) {
  return {...cinema, name: cinema.names?.[language] || cinema.name, address: cinema.addresses?.[language] || cinema.address};
}
export function localizeResult(data, language) {
  return {...data,
    films: (data.films || []).map(f => localizeFilm(f, language)),
    cinemas: (data.cinemas || []).map(c => localizeCinema(c, language)),
    cards: (data.cards || []).map(c => ({...c, film: localizeFilm(c.film, language), cinema: localizeCinema(c.cinema, language)})),
    orders: (data.orders || []).map(o => ({...o, film_title: o.film_titles?.[language] || o.film_title, cinema_name: o.cinema_names?.[language] || o.cinema_name})),
    coupons: (data.coupons || []).map(c => ({...c, cinema_name: c.cinema_names?.[language] || c.cinema_name})),
  };
}
export function selectedFilmTitle(filters, films, language) {
  const film = (films || []).find(f => String(f.id) === String(filters.film_id)
    || Object.values(f.titles || {}).includes(filters.film_query));
  return film?.titles?.[language] || filters.film_query;
}
