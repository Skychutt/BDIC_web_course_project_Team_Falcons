import { esc } from './ui.js';

export function filmRating(film) {
  const rating = film.rating;
  if (!rating?.count || rating.average == null) return 'No ratings yet';
  return `<span class="film-score"><strong>★ ${esc(Number(rating.average).toFixed(1))}</strong><span> / 10</span></span><span class="rating-votes">${Number(rating.count).toLocaleString('en-US')} ratings</span>`;
}
