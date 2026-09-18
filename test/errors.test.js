import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError, ERROR_KIND, classifyHttpStatus, fromHttpError } from '../src/providers/errors.js';

test('zarazeni podle stavoveho kodu', () => {
    assert.equal(classifyHttpStatus(429), ERROR_KIND.RATE_LIMIT);
    assert.equal(classifyHttpStatus(403), ERROR_KIND.BLOCKED);
    assert.equal(classifyHttpStatus(404), ERROR_KIND.GONE);
    assert.equal(classifyHttpStatus(500), ERROR_KIND.TEMPORARY);
    assert.equal(classifyHttpStatus(503), ERROR_KIND.TEMPORARY);
});

test('chyba site je docasna', () => {
    const err = fromHttpError(Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }));
    assert.equal(err.kind, ERROR_KIND.TEMPORARY);
    assert.ok(err instanceof ProviderError);
});

test('odpoved s HTML vyzvou je blokace i pri kodu 200', () => {
    const err = fromHttpError({ response: { status: 200, data: '<html><title>Please wait</title></html>' } });
    assert.equal(err.kind, ERROR_KIND.BLOCKED);
});

test('ProviderError nese stavovy kod', () => {
    const err = new ProviderError(ERROR_KIND.GONE, 'Not found', 404);
    assert.equal(err.status, 404);
    assert.equal(err.kind, 'gone');
});
