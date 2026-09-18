import { URL } from 'url';
import Logger from '../../utils/logger.js';
import ConfigurationManager from '../../utils/config_manager.js';
import { fetchCookie } from '../../api/fetchCookie.js';
import { fetchCatalogItems } from '../../api/fetchCatalogItems.js';
import { fetchItemDetail } from '../../api/fetchItemDetail.js';
import { VintedItem } from '../../entities/vinted_item.js';
import { buildApiFiltersFromUrl, hasAnyFilter as hasAnyVintedFilter } from '../../services/url_service.js';
import { createVintedItemEmbed, createVintedItemActionRow } from '../../bot/components/item_embed.js';
import { fromHttpError } from '../errors.js';

const ITEMS_PER_REQUEST = 20;
const COOKIE_REFRESH_INTERVAL_MS = 60000;
const SMOKE_TEST_FILTERS = { catalog_ids: ['1231'] };

// Prihlaseni je vec poskytovatele, ne hlidaci smycky. Aukro zadnou relaci nema.
let cookie = null;
let refreshTimer = null;

async function refreshCookie() {
    try {
        const fetched = await fetchCookie();
        if (fetched.cookie) {
            cookie = fetched.cookie;
            Logger.debug('Cookie Vintedu obnovena');
        }
    } catch (error) {
        Logger.debug('Cookie Vintedu se nepodarilo obnovit');
    }
}

function domainFromUrl(url) {
    const match = String(url).match(/vinted\.([a-z.]+?)\//);
    return match ? match[1] : ConfigurationManager.getAlgorithmSetting.vinted_api_domain_extension;
}

function failureToError(response) {
    return fromHttpError({
        response: { status: response.code || 0 },
        message: response.error || 'Chyba katalogu Vintedu',
    });
}

const vintedProvider = {
    name: 'vinted',

    matchesUrl(url) {
        try {
            return new URL(url).hostname.includes('vinted.');
        } catch (error) {
            return false;
        }
    },

    buildQuery(url) {
        const filters = buildApiFiltersFromUrl(url);
        return filters ? { filters, url, dropped: [] } : null;
    },

    hasAnyFilter(query) {
        return Boolean(query) && hasAnyVintedFilter(query.filters);
    },

    async init() {
        await refreshCookie();
        if (!refreshTimer) {
            refreshTimer = setInterval(refreshCookie, COOKIE_REFRESH_INTERVAL_MS);
            refreshTimer.unref?.();
        }
    },

    async fetchNewest(query) {
        const response = await fetchCatalogItems({ cookie, filters: query.filters, per_page: ITEMS_PER_REQUEST });

        if (!response.success) {
            throw failureToError(response);
        }

        const items = [];
        for (const raw of response.items || []) {
            const item = new VintedItem(raw);
            const detail = await fetchItemDetail({ cookie, url: item.url });
            item.mergeDetail(detail);

            items.push({
                id: String(item.id),
                title: item.title,
                description: item.description === 'N/A' ? '' : item.description,
                brand: item.brand === 'N/A' ? '' : item.brand,
                url: item.url,
                // Vinted neposila cas vlozeni, jen cas posledni zmeny.
                postedAt: new Date(item.unixUpdatedAt * 1000),
                raw: item,
            });
        }

        return items;
    },

    async buildMessage(item, channel) {
        const domain = domainFromUrl(channel?.url || item.url);
        const { embed, photosEmbeds } = await createVintedItemEmbed(item.raw, domain);
        const actionRow = await createVintedItemActionRow(item.raw, domain);
        return { embeds: [embed, ...photosEmbeds], components: [actionRow] };
    },

    async smokeTest() {
        const startedAt = Date.now();
        const response = await fetchCatalogItems({ cookie, filters: SMOKE_TEST_FILTERS, per_page: 5 });

        if (!response.success) {
            throw failureToError(response);
        }

        return { count: (response.items || []).length, durationMs: Date.now() - startedAt };
    },
};

export default vintedProvider;
