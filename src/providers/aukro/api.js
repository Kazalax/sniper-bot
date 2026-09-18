import axios from 'axios';
import { toMonitoredItem } from './item.js';
import { fromHttpError, ProviderError, ERROR_KIND } from '../errors.js';

const SEARCH_URL = 'https://aukro.cz/backend-web/api/offers/searchItemsCommon';
const REQUEST_TIMEOUT_MS = 15000;
// Razeni je vzdy od nejnovejsich, jinak Aukro radi podle relevance.
const SORT_NEWEST = 'startingTime:DESC';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

export async function fetchNewest(query, limit) {
    let response;

    try {
        response = await axios.post(SEARCH_URL, query.body, {
            params: { page: 0, size: limit, sort: SORT_NEWEST },
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Accept-Subbrand': 'BAZAAR',
                'User-Agent': USER_AGENT,
            },
        });
    } catch (error) {
        throw fromHttpError(error);
    }

    if (!response.data || !Array.isArray(response.data.content)) {
        throw new ProviderError(ERROR_KIND.SHAPE, 'Odpoved Aukra nema pole content', response.status);
    }

    return response.data.content.map(toMonitoredItem);
}
