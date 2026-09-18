import test from 'node:test';
import assert from 'node:assert/strict';
import HealthReporter from '../src/services/health_reporter.js';
import { ProviderError, ERROR_KIND } from '../src/providers/errors.js';

function setup() {
    const sent = [];
    let clock = new Date('2026-09-18T12:00:00Z').getTime();
    HealthReporter.reset();
    HealthReporter.configure({
        send: async text => { sent.push(text); },
        now: () => new Date(clock),
    });
    return { sent, advance: minutes => { clock += minutes * 60000; } };
}

test('mlci, dokud nejsou tri selhani za sebou', async () => {
    const { sent } = setup();
    const error = new ProviderError(ERROR_KIND.TEMPORARY, 'timeout');
    await HealthReporter.recordFailure('aukro', error, 2);
    await HealthReporter.recordFailure('aukro', error, 2);
    assert.equal(sent.length, 0);
    await HealthReporter.recordFailure('aukro', error, 2);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /aukro/);
});

test('zrusena adresa se hlasi hned', async () => {
    const { sent } = setup();
    await HealthReporter.recordFailure('vinted', new ProviderError(ERROR_KIND.GONE, 'Not found', 404), 3);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /zrusen/i);
});

test('pripomina jednou za hodinu', async () => {
    const { sent, advance } = setup();
    const error = new ProviderError(ERROR_KIND.BLOCKED, 'blokace', 403);
    for (let i = 0; i < 3; i++) {
        await HealthReporter.recordFailure('aukro', error, 1);
    }
    assert.equal(sent.length, 1);

    advance(30);
    await HealthReporter.recordFailure('aukro', error, 1);
    assert.equal(sent.length, 1, 'do hodiny nic navic');

    advance(31);
    await HealthReporter.recordFailure('aukro', error, 1);
    assert.equal(sent.length, 2);
});

test('obnoveni se hlasi i s dobou vypadku', async () => {
    const { sent, advance } = setup();
    const error = new ProviderError(ERROR_KIND.TEMPORARY, 'timeout');
    for (let i = 0; i < 3; i++) {
        await HealthReporter.recordFailure('aukro', error, 1);
    }
    advance(90);
    await HealthReporter.recordSuccess('aukro');
    assert.equal(sent.length, 2);
    assert.match(sent[1], /obnoven/i);
    assert.match(sent[1], /1 h 30 min/);
});

test('uspech bez predchozi poruchy nic neposila', async () => {
    const { sent } = setup();
    await HealthReporter.recordSuccess('aukro');
    assert.equal(sent.length, 0);
});

test('bez nastaveneho odesilani to nespadne', async () => {
    HealthReporter.reset();
    await HealthReporter.recordFailure('aukro', new ProviderError(ERROR_KIND.GONE, 'pryc', 404), 1);
});
