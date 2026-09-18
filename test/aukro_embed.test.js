import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage } from '../src/providers/aukro/embed.js';
import { toMonitoredItem } from '../src/providers/aukro/item.js';

const RAW = {
    itemId: 1, itemName: 'Mikina', seoUrl: 'mikina',
    startingTime: '2026-09-16T20:24:02+02:00', endingTime: '2026-09-23T20:23:22+02:00',
    auction: true, price: { amount: 745, currency: 'CZK' },
    priceWithShipping: { amount: 844, currency: 'CZK' },
    titleImageUrl: 'https://cdn.aukro.cz/x.jpeg', location: 'Brno',
    attributes: [{ attributeName: 'Stav zboží', attributeValue: 'Zánovní' }],
    seller: { showName: 'prodejce', positiveFeedbackPercentage: 98.5, feedbackUniqueUserCount: 40 },
};

test('zprava obsahuje cenu a odkaz', async () => {
    const { embeds, components } = await buildMessage(toMonitoredItem(RAW));
    const data = embeds[0].toJSON();
    assert.equal(data.url, 'https://aukro.cz/mikina-1');
    assert.ok(data.fields.some(field => field.value.includes('745')));
    assert.equal(components.length, 1);
});

test('stav zbozi se precte i s diakritikou', async () => {
    const { embeds } = await buildMessage(toMonitoredItem(RAW));
    const fields = embeds[0].toJSON().fields;
    assert.ok(fields.some(field => field.name === 'Stav' && field.value === 'Zánovní'));
});

test('u aukce je cas konce', async () => {
    const { embeds } = await buildMessage(toMonitoredItem(RAW));
    assert.ok(embeds[0].toJSON().fields.some(field => field.name === 'Aukce konci'));
});

test('zadne pole nema prazdnou hodnotu', async () => {
    const raw = { ...RAW, location: '', attributes: [], seller: {}, priceWithShipping: null };
    const { embeds } = await buildMessage(toMonitoredItem(raw));
    for (const field of embeds[0].toJSON().fields) {
        assert.ok(field.value.trim().length > 0, `prazdne pole ${field.name}`);
    }
});
