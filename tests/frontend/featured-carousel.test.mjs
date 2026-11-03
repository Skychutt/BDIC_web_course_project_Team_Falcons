import test from 'node:test';
import assert from 'node:assert/strict';
import { bindFeaturedCarousel } from '../../cinema/static/js/featured-carousel.js';
import { renderCatalogue } from '../../cinema/static/js/catalogue.js';
import { filmRating } from '../../cinema/static/js/film-rating.js';

// Small event/timer harness: no browser, network, database or real-time waits.
function fixture({reduced = false, size = 5} = {}) {
  class Element {
    handlers = new Map(); attrs = {}; dataset = {}; textContent = '';
    classList = { toggle: (key, value) => { this.attrs[key] = value; } };
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    removeEventListener(type) { this.handlers.delete(type); }
    emit(type, event = {}) { this.handlers.get(type)?.(event); }
    setAttribute(key, value) { this.attrs[key] = value; }
    closest() { return this; }
  }
  const carousel = new Element(), doc = new Element(), motion = new Element();
  doc.hidden = false; motion.matches = reduced;
  const slides = Array.from({length:size}, () => new Element());
  const stage = new Element();
  carousel.querySelectorAll = selector => selector === '[data-featured-slide]' ? slides : [];
  carousel.querySelector = selector => selector === '[data-featured-stage]' ? stage : null;
  carousel.contains = el => !!el;
  let seq = 0; const jobs = new Map();
  const cleanup = bindFeaturedCarousel({querySelector:() => carousel}, {doc,motion,
    later:fn => {const id=++seq; jobs.set(id,fn); return id;}, cancel:id=>jobs.delete(id)});
  const tick = () => {const next=jobs.entries().next().value; if(next) {jobs.delete(next[0]);next[1]();}};
  const action = name => carousel.emit('click',{target:Object.assign(new Element(),{dataset:{featuredAction:name}})});
  const active = () => slides.findIndex(slide => slide.attrs['aria-hidden'] === 'false');
  return {slides,active,stage,jobs,cleanup,tick,action,carousel,doc,motion};
}

test('automatic rotation visits every film, wraps, and cleanup removes pending work', () => {
  const f=fixture();
  for (const expected of [1,2,3,4,0]) {
    f.tick(); assert.equal(f.active(),expected);
    assert.equal(f.slides.filter(s=>!s.inert).length,1);
    assert.equal(f.slides.filter(s=>s.attrs['aria-hidden']==='false').length,1);
  }
  f.cleanup(); assert.equal(f.jobs.size,0);
  assert.equal(f.doc.handlers.size,0); assert.equal(f.motion.handlers.size,0);
  assert.equal(f.carousel.handlers.size,0);
});

test('both arrows work while hover, focus and hidden tabs suspend automatic rotation', () => {
  const f=fixture();
  f.action('prev'); assert.equal(f.active(),4);
  f.action('next'); assert.equal(f.active(),0);
  f.carousel.emit('mouseenter'); assert.equal(f.jobs.size,0);
  f.carousel.emit('mouseleave'); assert.equal(f.jobs.size,1);
  f.carousel.emit('focusin'); assert.equal(f.jobs.size,0);
  f.carousel.emit('focusout',{relatedTarget:null}); assert.equal(f.jobs.size,1);
  f.doc.hidden=true; f.doc.emit('visibilitychange'); assert.equal(f.jobs.size,0);
  f.doc.hidden=false; f.doc.emit('visibilitychange'); assert.equal(f.jobs.size,1);
  f.cleanup();
});

test('reduced motion starts paused and a single film needs no timer', () => {
  const f=fixture({reduced:true});
  assert.equal(f.jobs.size,0);
  f.action('next'); assert.equal(f.active(),1); assert.equal(f.jobs.size,0);
  f.motion.matches=false; f.motion.emit('change'); assert.equal(f.jobs.size,1); f.cleanup();
  assert.equal(fixture({size:1}).jobs.size,0);
});

test('unified scores use a single 10-point display and film-specific links', () => {
  const films = ['<First>', 'Second'].map((title,i)=>({id:String(i+1),title,synopsis:'Example',duration_minutes:86,
    genres:[],rating:{average:'6.0',count:53066,scale:10}}));
  const html=renderCatalogue({films,cinemas:[]},{date:'2026-10-25',party_size:2});
  assert.match(html,/film_id=1/); assert.match(html,/film_id=2/);
  assert.match(html,/&lt;First&gt;/); assert.doesNotMatch(html,/Beijing cinemas/);
  assert.equal((html.match(/data-featured-action=/g) || []).length,2);
  assert.doesNotMatch(html,/data-featured-index|data-featured-count|featured-toggle|Pause/);
  assert.match(filmRating(films[0]),/6\.0/); assert.match(filmRating(films[0]),/\/ 10/);
  assert.match(filmRating(films[0]),/53,066 ratings/);
  assert.doesNotMatch(filmRating(films[0]),/Douban|豆瓣|Site users|\/ 5/);
  assert.equal(filmRating({rating:{average:null,count:0,scale:10}}),'No ratings yet');
});
