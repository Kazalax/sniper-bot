import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeenState, selectNewItems } from '../src/services/new_items.js';

const NOW = new Date('2026-09-18T12:00:00Z');
const minutesAgo = (base, minutes) => new Date(base.getTime() - minutes * 60000);

function item(id, postedAt) {
    return { id, title: `polozka ${id}`, description: '', brand: '', url: `https://aukro.cz/x-${id}`, postedAt, raw: {} };
}

test('prvni beh nic neposle, jen si zapamatuje stav', () => {
    const state = createSeenState();
    const found = selectNewItems([item('1', minutesAgo(NOW, 1)), item('2', minutesAgo(NOW, 2))], state, NOW);
    assert.deepEqual(found, []);
    assert.equal(state.seen.size, 2);
});

test('nove ID se posle, zname uz ne', () => {
    const state = createSeenState();
    selectNewItems([item('1', minutesAgo(NOW, 5))], state, NOW);
    const found = selectNewItems([item('2', minutesAgo(NOW, 1)), item('1', minutesAgo(NOW, 5))], state, NOW);
    assert.deepEqual(found.map(entry => entry.id), ['2']);
});

test('stejny inzerat podruhe uz neprijde', () => {
    const state = createSeenState();
    selectNewItems([item('1', minutesAgo(NOW, 5))], state, NOW);
    selectNewItems([item('2', minutesAgo(NOW, 1))], state, NOW);
    const found = selectNewItems([item('2', minutesAgo(NOW, 1))], state, NOW);
    assert.deepEqual(found, []);
});

test('stary inzerat nove zarazeny do vypisu se neposle', () => {
    const state = createSeenState();
    selectNewItems([item('1', minutesAgo(NOW, 1))], state, NOW);
    const found = selectNewItems([item('stary', minutesAgo(NOW, 600)), item('1', minutesAgo(NOW, 1))], state, NOW);
    assert.deepEqual(found, []);
});

test('vysledek je serazeny od nejstarsiho', () => {
    const state = createSeenState();
    selectNewItems([item('1', minutesAgo(NOW, 9))], state, NOW);
    const found = selectNewItems([
        item('3', minutesAgo(NOW, 1)),
        item('2', minutesAgo(NOW, 4)),
        item('1', minutesAgo(NOW, 9)),
    ], state, NOW);
    assert.deepEqual(found.map(entry => entry.id), ['2', '3']);
});

test('stara ID se ze seznamu zahazuji', () => {
    const state = createSeenState();
    selectNewItems([item('stare', minutesAgo(NOW, 600))], state, NOW);
    selectNewItems([item('nove', NOW)], state, NOW);
    assert.equal(state.seen.has('stare'), false);
    assert.equal(state.seen.has('nove'), true);
});
