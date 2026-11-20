import { esc, icon, poster } from './ui.js';
import { filmArtwork } from './film-artwork.js';
import { filmRating } from './film-rating.js';
import { filmTitle, filmSynopsis, genreName } from './film-locale.js';
import { tx } from './locale.js';

// The homepage uses public catalogue facts only; it never invents release dates or scores.
export function filmShowtimesLink(film, filters) {
  return '#/discover?' + new URLSearchParams({
    date: filters.date,
    party_size: String(filters.party_size || 1),
    film_id: film.id,
  });
}
export function renderCatalogue(bootstrap, filters, activeFilmId) {
  const films = bootstrap.films.filter(film => !film.archived);
  if (!films.length) return '';
  const activeIndex = Math.max(0, films.findIndex(film => String(film.id) === activeFilmId));
  const cinemas = bootstrap.cinemas.filter(cinema => cinema.is_active);
  const filmWord = (count) => tx(count === 1 ? 'film' : 'films', '部影片');
  return `<section class="featured-carousel" data-featured-carousel role="region" aria-roledescription="${tx('carousel', '轮播')}" aria-label="${tx('Featured films', '精选影片')}">
    <div class="featured-slides" data-featured-stage aria-live="off">${films.map((featured, index) => {
      const active = index === activeIndex;
      const title = esc(filmTitle(featured));
      const featurePoster = filmArtwork(featured);
      const hasArtwork = featured.title === 'Journey Beyond the City';
      return `<article class="featured-slide cinema-hero ${hasArtwork ? 'city-feature' : ''} ${featurePoster ? 'poster-feature' : ''} ${active ? 'is-active' : ''}" data-featured-slide data-featured-film-id="${esc(featured.id)}" role="group" aria-roledescription="${tx('slide', '影片')}" aria-label="${tx(`${index + 1} of ${films.length}`, `第 ${index + 1} / ${films.length} 部`)}: ${title}" aria-hidden="${!active}" ${active ? '' : 'inert'}>
    <div class="hero-copy"><p class="hero-kicker"><span></span> ${tx('CURATED DEMO PROGRAMME', '精选演示片单')}</p>
      <h1 id="featured-film-title-${index}">${title}</h1>
      <p class="hero-description">${esc(filmSynopsis(featured))}</p>
      <p class="hero-rating">${filmRating(featured)}</p>
      <div class="hero-metadata"><span>${esc(featured.duration_minutes)} ${tx('min', '分钟')}</span>${featured.genres.map(genre => `<span>${esc(genreName(genre))}</span>`).join('')}</div>
      <div class="hero-actions"><a class="button" href="${filmShowtimesLink(featured, filters)}">${icon('ticket')} ${tx('Find showtimes', '查找场次')}</a><a class="hero-details" href="#/film/${esc(featured.id)}">${tx('Explore the film', '了解这部影片')} ${icon('arrow')}</a></div>
    </div>${featurePoster ? `<img class="hero-film-artwork" src="${featurePoster}" alt="${title} ${tx('poster', '海报')}" decoding="async" ${active ? 'fetchpriority="high"' : ''}>` : ''}
    </article>`;
    }).join('')}</div>
    ${films.length > 1 ? `<div class="featured-controls"><button type="button" data-featured-action="prev" aria-label="${tx('Previous film', '上一部')}">‹</button><button type="button" data-featured-action="next" aria-label="${tx('Next film', '下一部')}">›</button></div>` : ''}
  </section>
  <section class="catalogue-section" aria-labelledby="catalogue-title">
    <div class="catalogue-heading"><div><span class="section-marker"></span><h2 id="catalogue-title">${tx('Explore the films', '浏览影片')}</h2><span class="catalogue-count">${films.length} ${filmWord(films.length)}</span></div><a href="#/cinemas">${tx(`${cinemas.length} cinemas in Beijing`, `北京 ${cinemas.length} 家影院`)} ${icon('chevron')}</a></div>
    <div class="catalogue-layout ${films.length === 1 ? 'single-film' : ''}"><div class="film-rail">${films.map(film => `<article class="catalogue-film">
      <a class="catalogue-poster" href="#/film/${esc(film.id)}" aria-label="${tx('About', '关于')} ${esc(filmTitle(film))}">${poster(film)}</a>
      <div class="catalogue-film-copy"><p class="catalogue-label">${tx('IN THE CATALOGUE', '片单中')}</p><h3><a href="#/film/${esc(film.id)}">${esc(filmTitle(film))}</a></h3><p class="catalogue-rating">${filmRating(film)}</p><p class="catalogue-meta">${esc(film.duration_minutes)} ${tx('min', '分钟')}${film.genres.map(genre => ` · ${esc(genreName(genre))}`).join('')}</p><p class="catalogue-synopsis">${esc(filmSynopsis(film))}</p><a class="button" href="${filmShowtimesLink(film, filters)}">${tx('View showtimes', '查看场次')} ${icon('arrow')}</a></div>
    </article>`).join('')}</div>
    <aside class="concierge-card"><span class="concierge-icon">${icon('spark')}</span><p class="eyebrow">${tx('FALCONS AI ASSISTANT', 'FALCONS 观影助手')}</p><h2>${tx('A movie night,<br>made for you.', '一场电影，<br>按你的安排来。')}</h2><p>${tx('A time that works. A cinema nearby.<br>Seats for your whole group.', '合适的时间。附近的影院。<br>整组都能坐下。')}</p><button type="button" data-open-assistant class="button">${tx('Ask the assistant', '问问助手')} ${icon('spark')}</button><span class="concierge-languages">${tx('中文 / English · Your preferences, remembered', '中文 / English · 记住你的偏好')}</span></aside></div>
  </section>`;
}
