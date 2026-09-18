import test from 'node:test';
import assert from 'node:assert/strict';
import { toMonitoredItem } from '../src/providers/aukro/item.js';
import { ERROR_KIND } from '../src/providers/errors.js';

// Tvar odpovida skutecne odpovedi Aukra vcetne diakritiky v nazvech atributu.
const RAW = {
    itemId: 7133849979,
    itemName: 'Zakladni mikina',
    seoUrl: 'zakladni-mikina',
    startingTime: '2026-09-16T20:24:02.572+02:00',
    endingTime: '2026-09-23T20:23:22+02:00',
    auction: true,
    buyNowActive: true,
    price: { amount: 745, currency: 'CZK' },
    priceWithShipping: { amount: 844, currency: 'CZK' },
    titleImageUrl: 'https://cdn.aukro.cz/images/x/zakladni-mikina.jpeg',
    location: 'Komjatna',
    attributes: [
        { attributeName: 'Stav zboží', attributeValue: 'Zánovní' },
        { attributeName: 'Značka', attributeValue: 'Nike' },
    ],
    seller: { showName: 'matiasb4', positiveFeedbackPercentage: 98.5, feedbackUniqueUserCount: 40 },
};

test('sestavi odkaz ze seoUrl a ID', () => {
    const item = toMonitoredItem(RAW);
    assert.equal(item.url, 'https://aukro.cz/zakladni-mikina-7133849979');
    assert.equal(item.id, '7133849979');
});

test('prevezme nazev, znacku a cas vlozeni', () => {
    const item = toMonitoredItem(RAW);
    assert.equal(item.title, 'Zakladni mikina');
    assert.equal(item.brand, 'Nike');
    assert.equal(item.postedAt.toISOString(), new Date('2026-09-16T20:24:02.572+02:00').toISOString());
});

test('inzerat bez ID je chyba tvaru', () => {
    assert.throws(() => toMonitoredItem({ itemName: 'bez id' }), error => error.kind === ERROR_KIND.SHAPE);
});

test('chybejici znacka nevadi', () => {
    const item = toMonitoredItem({ ...RAW, attributes: [] });
    assert.equal(item.brand, '');
});
