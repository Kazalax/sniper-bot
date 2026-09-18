import { resolveProvider } from '../providers/index.js';

/**
 * Overi, jestli se adresa da hlidat. O tom, jak vypadaji adresy jednotlivych webu,
 * rozhoduje poskytovatel vybrany podle domeny, prikaz sam uz to nevi.
 * @param {string} url - Adresa vyhledavani zadana uzivatelem.
 * @returns {true|string} - true, nebo klic chybove hlasky pro preklad.
 */
export function validateMonitoringUrl(url) {
    const provider = resolveProvider(url);

    if (!provider) {
        return 'unsupported-site';
    }

    const query = provider.buildQuery(url);

    if (!query) {
        return 'invalid-url';
    }

    // Hledani bez jedineho filtru by hlidalo cely web a zahltilo kanal.
    if (!provider.hasAnyFilter(query)) {
        return 'must-have-supported-filter';
    }

    return true;
}

/**
 * Vinted vraci u parametru search_text nepresne vysledky, na coz se uzivatel upozornuje.
 * Aukra se to netyka.
 * @param {string} url - Adresa vyhledavani.
 * @returns {boolean}
 */
export function urlNeedsSearchTextWarning(url) {
    const provider = resolveProvider(url);

    if (!provider || provider.name !== 'vinted') {
        return false;
    }

    try {
        return new URL(url).searchParams.has('search_text');
    } catch (error) {
        return false;
    }
}
