import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNewest } from '../src/providers/aukro/api.js';

// Aukro nepotrebuje prihlaseni, takze se testuje proti zivemu API. Bez site se
// test preskoci, aby nepadal bez duvodu.
test('vrati nejnovejsi inzeraty serazene od nejnovejsiho', async (t) => {
    let items;
    try {
        items = await fetchNewest({ body: { categorySeoUrl: 'panske-mikiny' } }, 5);
    } catch (error) {
        t.skip(`Aukro neni dostupne: ${error.message}`);
        return;
    }

    assert.ok(items.length > 0);
    assert.ok(items[0].url.startsWith('https://aukro.cz/'));
    for (let i = 1; i < items.length; i++) {
        assert.ok(items[i - 1].postedAt >= items[i].postedAt, 'poradi podle casu');
    }
});
