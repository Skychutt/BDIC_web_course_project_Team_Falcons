import { esc, icon, poster } from './ui.js';
import { filmArtwork } from './film-artwork.js';
import { filmRating } from './film-rating.js';

// The homepage uses public catalogue facts only; it never invents release dates or scores.
export function filmShowtimesLink(film, filters) {
  return '#/discover?' + new URLSearchParams({
    date: filters.date,
    party_size: String(filters.party_size || 1),
    film_id: film.id,
  });
}
export function renderCatalogue(bootstrap, filters) {
  const films = bootstrap.films.filter(film => !film.archived);
  if (!films.length) return '';
  const cinemas = bootstrap.cinemas.filter(cinema => cinema.is_active);
  return `<section class="featured-carousel" data-featured-carousel role="region" aria-roledescription="carousel" aria-label="Featured films">
    <div class="featured-slides" data-featured-stage aria-live="off">${films.map((featured, index) => {
      const featurePoster = filmArtwork(featured);
      const hasArtwork = featured.title === 'Journey Beyond the City';
      return `<article class="featured-slide cinema-hero ${hasArtwork ? 'city-feature' : ''} ${featurePoster ? 'poster-feature' : ''} ${index === 0 ? 'is-active' : ''}" data-featured-slide role="group" aria-roledescription="slide" aria-label="${index + 1} of ${films.length}: ${esc(featured.title)}" aria-hidden="${index !== 0}" ${index !== 0 ? 'inert' : ''}>
    <div class="hero-copy"><p class="hero-kicker"><span></span> CURATED DEMO PROGRAMME</p>
      <h1 id="featured-film-title-${index}">${esc(featured.title)}</h1>
      <p class="hero-description">${esc(featured.synopsis)}</p>
      <p class="hero-rating">${filmRating(featured)}</p>
      <div class="hero-metadata"><span>${esc(featured.duration_minutes)} min</span>${featured.genres.map(genre => `<span>${esc(genre.name)}</span>`).join('')}</div>
      <div class="hero-actions"><a class="button" href="${filmShowtimesLink(featured, filters)}">${icon('ticket')} Find showtimes</a><a class="hero-details" href="#/film/${esc(featured.id)}">Explore the film ${icon('arrow')}</a></div>
    </div>${featurePoster ? `<img class="hero-film-artwork" src="${featurePoster}" alt="${esc(featured.title)} poster" decoding="async" ${index === 0 ? 'fetchpriority="high"' : ''}>` : ''}
    </article>`;
    }).join('')}</div>
    ${films.length > 1 ? `<div class="featured-controls"><button type="button" data-featured-action="prev" aria-label="Previous film">‹</button><button type="button" data-featured-action="next" aria-label="Next film">›</button></div>` : ''}
  </section>
  <section class="catalogue-section" aria-labelledby="catalogue-title">
    <div class="catalogue-heading"><div><span class="section-marker"></span><h2 id="catalogue-title">Explore the films</h2><span class="catalogue-count">${films.length} ${films.length === 1 ? 'film' : 'films'}</span></div><a href="#/cinemas">${cinemas.length} cinemas in Beijing ${icon('chevron')}</a></div>
    <div class="catalogue-layout ${films.length === 1 ? 'single-film' : ''}"><div class="film-rail">${films.map(film => `<article class="catalogue-film">
      <a class="catalogue-poster" href="#/film/${esc(film.id)}" aria-label="About ${esc(film.title)}">${poster(film)}</a>
      <div class="catalogue-film-copy"><p class="catalogue-label">IN THE CATALOGUE</p><h3><a href="#/film/${esc(film.id)}">${esc(film.title)}</a></h3><p class="catalogue-rating">${filmRating(film)}</p><p class="catalogue-meta">${esc(film.duration_minutes)} min${film.genres.map(genre => ` · ${esc(genre.name)}`).join('')}</p><p class="catalogue-synopsis">${esc(film.synopsis)}</p><a class="button" href="${filmShowtimesLink(film, filters)}">View showtimes ${icon('arrow')}</a></div>
    </article>`).join('')}</div>
    <aside class="concierge-card"><span class="concierge-icon">${icon('spark')}</span><p class="eyebrow">FALCONS AI ASSISTANT</p><h2>A movie night,<br>made for you.</h2><p>A time that works. A cinema nearby.<br>Seats for your whole group.</p><button type="button" data-open-assistant class="button">Ask the assistant ${icon('spark')}</button><span class="concierge-languages">中文 / English · Your preferences, remembered</span></aside></div>
  </section>`;
}
