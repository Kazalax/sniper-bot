import { ProviderError, ERROR_KIND } from '../errors.js';

const ITEM_BASE_URL = 'https://aukro.cz';

// Aukro posila nazvy atributu s diakritikou ("Znacka", "Stav zbozi"). Porovnava se
// bez ni, aby zmena velkych pismen nebo diakritiky nerozbila cteni.
function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function attribute(raw, name) {
    const wanted = normalize(name);
    const found = (raw.attributes || []).find(entry => normalize(entry.attributeName) === wanted);
    return found ? found.attributeValue : '';
}

// Aukro neposila popis inzeratu ve vypisu, proto zustava prazdny.
export function toMonitoredItem(raw) {
    if (!raw || !raw.itemId || !raw.startingTime) {
        throw new ProviderError(ERROR_KIND.SHAPE, 'Inzerat Aukra nema itemId nebo startingTime');
    }

    return {
        id: String(raw.itemId),
        title: raw.itemName || '',
        description: '',
        brand: attribute(raw, 'Znacka'),
        url: `${ITEM_BASE_URL}/${raw.seoUrl}-${raw.itemId}`,
        postedAt: new Date(raw.startingTime),
        raw,
    };
}
