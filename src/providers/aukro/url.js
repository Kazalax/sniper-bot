import { URL } from 'url';
import Logger from '../../utils/logger.js';

// Aukro tise ignoruje neznamy parametr a vrati vsechny vysledky, proto se
// prebiraji jen overene parametry a zbytek se zahodi.
const TEXT_PARAMS = ['text'];
const NUMBER_PARAMS = ['priceMin', 'priceMax'];

export function matchesUrl(url) {
    try {
        return new URL(url).hostname.endsWith('aukro.cz');
    } catch (error) {
        return false;
    }
}

export function buildQuery(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch (error) {
        Logger.error(`Neplatna URL Aukra: ${error.message}`);
        return null;
    }

    const body = {};
    const dropped = [];

    // Prvni cast cesty je kategorie, vcetne pripony -skladem pro "Kup ted".
    const category = parsed.pathname.split('/').filter(Boolean)[0];
    if (category) {
        body.categorySeoUrl = category;
    }

    for (const [key, value] of parsed.searchParams) {
        if (TEXT_PARAMS.includes(key) && value) {
            body[key] = value;
        } else if (NUMBER_PARAMS.includes(key) && value !== '' && Number.isFinite(Number(value))) {
            body[key] = Number(value);
        } else {
            dropped.push(key);
        }
    }

    return { body, dropped };
}

export function hasAnyFilter(query) {
    return Boolean(query) && Object.keys(query.body).length > 0;
}
