import { matchesUrl, buildQuery, hasAnyFilter } from './url.js';
import { fetchNewest } from './api.js';
import { buildMessage } from './embed.js';

// Kolik inzeratu se stahuje pri jedne kontrole. V kategorii obleceni pokrylo
// 180 inzeratu 54 hodin provozu, takze rezerva proti vynechani je velka.
const ITEMS_PER_REQUEST = 60;
const SMOKE_TEST_QUERY = { body: { categorySeoUrl: 'panske-mikiny' } };

const aukroProvider = {
    name: 'aukro',
    matchesUrl,
    buildQuery,
    hasAnyFilter,

    // Aukro nepotrebuje prihlaseni ani relaci.
    async init() {},

    async fetchNewest(query) {
        return fetchNewest(query, ITEMS_PER_REQUEST);
    },

    async buildMessage(item) {
        return buildMessage(item);
    },

    async smokeTest() {
        const startedAt = Date.now();
        const items = await fetchNewest(SMOKE_TEST_QUERY, 5);
        return { count: items.length, durationMs: Date.now() - startedAt };
    },
};

export default aukroProvider;
