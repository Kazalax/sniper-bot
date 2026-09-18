import test from 'node:test';
import assert from 'node:assert/strict';
import { runStatusCheck } from '../src/services/status_check.js';

test('bez URL zkontroluje vsechny weby', async () => {
    const results = await runStatusCheck();
    assert.ok(results.length >= 2);
    const aukro = results.find(entry => entry.provider === 'aukro');
    assert.ok(aukro, 'chybi vysledek pro aukro');
    assert.equal(typeof aukro.durationMs, 'number');
});

test('se zadanou URL ukaze prelozeny dotaz', async () => {
    const [result] = await runStatusCheck('https://aukro.cz/panske-mikiny?text=nike&priceTo=100');
    assert.equal(result.provider, 'aukro');
    assert.deepEqual(result.query.dropped, ['priceTo']);
});

test('neznama URL vraci chybu', async () => {
    const [result] = await runStatusCheck('https://example.com/neco');
    assert.equal(result.ok, false);
    assert.match(result.error, /nezna/i);
});

test('URL bez filtru se pozna jako chyba', async () => {
    const [result] = await runStatusCheck('https://aukro.cz/');
    assert.equal(result.ok, false);
    assert.match(result.error, /filtr/i);
});
