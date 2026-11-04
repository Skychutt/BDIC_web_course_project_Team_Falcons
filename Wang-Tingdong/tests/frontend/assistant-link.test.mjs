import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendationLink, businessLink } from '../../cinema/static/js/assistant.js';

const card = {
  screening_id: '4525876034177631649',
  suggested_seats: [{id:'3376409949362696086'}, {id:'4195876069290939308'}],
};

test('business links use only allowlisted routes and exact string IDs', () => {
  const id = '4525876034177631649';
  assert.equal(businessLink('film', id), '#/film/' + id);
  assert.equal(businessLink('order', id), '#/account?tab=orders&booking=' + id);
  assert.equal(businessLink('reschedule', id), '#/discover?source_booking_id=' + id);
  for (const bad of ['https://evil.invalid', '1?user=2', '-1', 4525876034177631649]) assert.equal(businessLink('film', bad), null);
  assert.equal(businessLink('pay', id), null);
});

test('booking link preserves BIGINT IDs and party size without number conversion', () => {
  const link = recommendationLink(card);
  const [path, query] = link.split('?');
  const params = new URLSearchParams(query);
  assert.equal(path, '#/seats/' + card.screening_id);
  assert.equal(params.get('seat_ids'), card.suggested_seats.map(s => s.id).join(','));
  assert.equal(params.get('party_size'), '2');
  assert.equal(params.get('from'), 'assistant');
  assert.equal(params.has('hold_id'), false);
});

test('refuses unsafe numeric IDs instead of linking to rounded values', () => {
  assert.equal(recommendationLink({...card, screening_id:Number(card.screening_id)}), null);
  assert.equal(recommendationLink({...card, suggested_seats:[{id:Number(card.suggested_seats[0].id)}]}), null);
});

test('never uses arbitrary paths or URLs as a booking target', () => {
  for (const id of ['https://example.com', '../1', '1?hold_id=2', '1#other']) {
    assert.equal(recommendationLink({...card, screening_id:id}), null);
    assert.equal(recommendationLink({...card, suggested_seats:[{id}]}), null);
  }
});

test('refuses empty groups and groups exceeding the booking limit', () => {
  assert.equal(recommendationLink({...card, suggested_seats:[]}), null);
  assert.equal(recommendationLink({...card, suggested_seats:Array.from({length:13}, (_,i)=>({id:String(i+1)}))}), null);
  assert.ok(recommendationLink({...card, suggested_seats:[{id:'1'}]}));
});
