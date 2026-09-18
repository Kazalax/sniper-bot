import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMonitoringUrl, urlNeedsSearchTextWarning } from '../src/services/url_validation.js';

test('adresa z Aukra projde', () => {
    assert.equal(validateMonitoringUrl('https://aukro.cz/panske-mikiny-skladem?priceMax=2000'), true);
});

test('adresa z Vintedu projde', () => {
    assert.equal(validateMonitoringUrl('https://www.vinted.cz/catalog?catalog[]=1231'), true);
});

test('cizi web se odmitne s vlastni hlaskou', () => {
    assert.equal(validateMonitoringUrl('https://example.com/neco'), 'unsupported-site');
});

test('hledani bez filtru se odmitne', () => {
    assert.equal(validateMonitoringUrl('https://aukro.cz/'), 'must-have-supported-filter');
});

test('upozorneni na search_text plati jen pro Vinted', () => {
    assert.equal(urlNeedsSearchTextWarning('https://www.vinted.cz/catalog?search_text=nike'), true);
    assert.equal(urlNeedsSearchTextWarning('https://aukro.cz/panske-mikiny?text=nike'), false);
});
