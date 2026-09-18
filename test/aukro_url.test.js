import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesUrl, buildQuery, hasAnyFilter } from '../src/providers/aukro/url.js';

test('pozna svou domenu', () => {
    assert.equal(matchesUrl('https://aukro.cz/panske-mikiny'), true);
    assert.equal(matchesUrl('https://www.aukro.cz/panske-mikiny'), true);
    assert.equal(matchesUrl('https://www.vinted.cz/catalog?catalog[]=1231'), false);
});

test('cesta se stane kategorii', () => {
    const { body } = buildQuery('https://aukro.cz/panske-mikiny');
    assert.equal(body.categorySeoUrl, 'panske-mikiny');
});

test('prebira povolene parametry', () => {
    const { body } = buildQuery('https://aukro.cz/panske-mikiny?text=nike&priceMin=200&priceMax=800');
    assert.equal(body.text, 'nike');
    assert.equal(body.priceMin, 200);
    assert.equal(body.priceMax, 800);
});

test('neznamy parametr zahodi a ohlasi', () => {
    const { body, dropped } = buildQuery('https://aukro.cz/panske-mikiny?priceTo=100&sort=price:ASC');
    assert.equal(body.priceTo, undefined);
    assert.deepEqual(dropped.sort(), ['priceTo', 'sort']);
});

test('nepouzitelna URL vraci null', () => {
    assert.equal(buildQuery('tohle neni url'), null);
});

test('URL bez filtru se pozna', () => {
    assert.equal(hasAnyFilter(buildQuery('https://aukro.cz/panske-mikiny')), true);
    assert.equal(hasAnyFilter(buildQuery('https://aukro.cz/')), false);
});
