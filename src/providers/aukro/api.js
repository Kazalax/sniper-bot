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

    // Kdyz hledany text odpovida znacce, Aukro misto vysledku posle presmerovani
    // na stranku znacky a prazdny seznam. Tenhle prepinac tomu zabrani.
    const body = { ...query.body, searchRedirectDisabled: true };

    try {
        response = await axios.post(SEARCH_URL, body, {
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

    // Pojistka: kdyby Aukro presmerovani poslalo i pres prepinac, hlasi se to
    // misto tiche nuly vysledku.
    if (response.data.redirectUrl && response.data.content.length === 0) {
        throw new ProviderError(ERROR_KIND.SHAPE, `Aukro misto vysledku vratilo presmerovani na ${response.data.redirectUrl}`, response.status);
    }

    return response.data.content.map(toMonitoredItem);
}
