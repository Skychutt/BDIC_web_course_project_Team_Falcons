import { esc } from './ui.js';
import { tx } from './locale.js';

export function filmRating(film) {
  const rating = film.rating;
  if (!rating?.count || rating.average == null) return tx('No ratings yet', '暂无评分');
  const votes = Number(rating.count).toLocaleString(tx('en-US', 'zh-CN'));
  return `<span class="film-score"><strong>★ ${esc(Number(rating.average).toFixed(1))}</strong><span> / 10</span></span><span class="rating-votes">${votes} ${tx('ratings', '条评分')}</span>`;
}
