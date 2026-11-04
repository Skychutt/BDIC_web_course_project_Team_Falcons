import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantDate, genreLabel, statusLabel, localizeResult, selectedFilmTitle, replyLanguage } from '../../cinema/static/js/assistant-locale.js';

test('replies follow each question, preserve language for numeric followups and allow translated names', () => {
  for (const [text, previous, expected] of [
    ['我想睡觉', 'en', 'zh'], ["I'm tired", 'zh', 'en'],
    ['Resident Evil 有哪些场次？', 'en', 'zh'], ['Show screenings for 肖申克的救赎', 'zh', 'en'],
    ['请推荐一部 IMAX 电影', 'en', 'zh'], ['Recommend a highly rated film', 'zh', 'en'],
    ['2', 'en', 'en'], ['2', 'zh', 'zh'], ['👍', 'en', 'en'],
  ]) assert.equal(replyLanguage(text, previous), expected);
});

test('switching card language preserves IDs, rankings, pricing, seats and raw facts', () => {
  const film = {id:'2286167629450124392',title:'原片名',synopsis:'原简介',titles:{zh:'中文片名',en:'English title'},synopses:{zh:'中文简介',en:'English synopsis'},genres:['Horror','Thriller'],rating:7.3};
  const cinema={id:'800000000000000001',name:'原影院',address:'原地址',names:{zh:'中文影院',en:'Cinema'},addresses:{zh:'中文地址',en:'Address'}};
  const raw={films:[film],cinemas:[cinema],cards:[{screening_id:'900000000000000001',film,cinema,fares:{regular:5800},suggested_seats:[{id:'900000000000000002',label:'1-2'}]}],orders:[{id:'1',film_title:'原片名',film_titles:film.titles,cinema_names:cinema.names,status:'CONFIRMED'}],coupons:[],filters:{party_size:2}};
  const before=structuredClone(raw), zh=localizeResult(raw,'zh'), en=localizeResult(raw,'en');
  assert.equal(zh.films[0].title,'中文片名'); assert.equal(en.films[0].synopsis,'English synopsis');
  assert.deepEqual(zh.films[0].genres,['恐怖','惊悚']); assert.deepEqual(en.films[0].genres,['Horror','Thriller']);
  assert.equal(en.cinemas[0].address,'Address'); assert.equal(en.orders[0].film_title,'English title');
  assert.equal(zh.cards[0].screening_id,en.cards[0].screening_id);
  assert.deepEqual(zh.cards[0].suggested_seats,en.cards[0].suggested_seats);
  assert.deepEqual(zh.cards[0].fares,en.cards[0].fares); assert.deepEqual(raw,before);
  assert.equal(localizeResult(en,'zh').films[0].synopsis,'中文简介');
  assert.equal(selectedFilmTitle({film_id:film.id,film_query:'原片名'},[film],'en'),'English title');
});

test('localized dates retain Beijing timezone, and statuses/genres have readable labels', () => {
  assert.match(assistantDate('2026-10-24T12:00:00Z','zh'),/10月24日.*20:00/);
  assert.match(assistantDate('2026-10-24T12:00:00Z','en'),/24 Oct.*20:00/);
  assert.equal(statusLabel('CINEMA_CANCELLED','zh'),'影院已取消');
  assert.equal(statusLabel('USED','en'),'Used'); assert.equal(genreLabel('科幻','en'),'Science Fiction');
  assert.equal(assistantDate('invalid','zh'),'—');
  assert.equal(localizeResult({films:[{title:'New film',synopsis:'Original'}]},'zh').films[0].title,'New film');
});
