import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, allProviders } from '../src/providers/index.js';

test('podle URL vybere spravneho poskytovatele', () => {
    assert.equal(resolveProvider('https://aukro.cz/panske-mikiny').name, 'aukro');
    assert.equal(resolveProvider('https://www.vinted.cz/catalog?catalog[]=1231').name, 'vinted');
    assert.equal(resolveProvider('https://example.com/neco'), null);
});

test('kazdy poskytovatel ma cele rozhrani', () => {
    for (const provider of allProviders()) {
        for (const method of ['matchesUrl', 'buildQuery', 'hasAnyFilter', 'init', 'fetchNewest', 'buildMessage', 'smokeTest']) {
            assert.equal(typeof provider[method], 'function', `${provider.name} nema ${method}`);
        }
    }
});
