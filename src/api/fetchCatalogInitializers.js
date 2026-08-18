import { executeWithDetailedHandling } from "../helpers/execute_helper.js";
import RequestBuilder from "../utils/request_builder.js";
import ConfigurationManager from "../utils/config_manager.js";
import { NotFoundError } from "../helpers/execute_helper.js";

const extension = ConfigurationManager.getAlgorithmSetting.vinted_api_domain_extension

// Vinted zrusilo endpoint /api/v2/catalog/initializers (dnes vraci 404), ze ktereho se
// puvodne bral strom kategorii. Stejna data dnes prijdou uz vyrenderovana ve strance
// /catalog jako serverovy payload pod klicem initialCatalogState -> dtos -> catalogs.
// Bez toho stromu uvizne main.js v nekonecne smycce getCatalogRoots a bot nikdy nenabehne.
const CATALOG_STATE_MARKER = 'initialCatalogState';
const CATALOGS_KEY = '"catalogs":[';
// Payload strance je velky (radove megabajty); okno drzi pamet na uzde na slabsim hardwaru.
const PAYLOAD_WINDOW_SIZE = 4_000_000;
// Stazeni cele HTML stranky trva déle nez API request, vychozich 5 s nestaci.
const CATALOG_PAGE_TIMEOUT_MS = 30_000;

/**
 * Extracts the catalog tree from the server-rendered payload of the /catalog page.
 * @param {string} html - Raw HTML of the catalog page.
 * @returns {Array<Object>} - Root catalog nodes, each with nested `catalogs`.
 */
function extractCatalogsFromPayload(html) {
    const stateIndex = html.indexOf(CATALOG_STATE_MARKER);
    if (stateIndex === -1) {
        throw new NotFoundError("Catalog state not found in the catalog page.");
    }

    // Payload je v HTML jako escapovany JS retezec, proto se escapy rusi pred parsovanim.
    const payload = html
        .slice(stateIndex, stateIndex + PAYLOAD_WINDOW_SIZE)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');

    const keyIndex = payload.indexOf(CATALOGS_KEY);
    if (keyIndex === -1) {
        throw new NotFoundError("Catalog tree not found in the catalog page.");
    }

    const arrayStart = keyIndex + CATALOGS_KEY.length - 1;
    let depth = 0;
    let insideString = false;
    let escaped = false;

    for (let i = arrayStart; i < payload.length; i++) {
        const char = payload[i];

        if (insideString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                insideString = false;
            }
            continue;
        }

        if (char === '"') {
            insideString = true;
        } else if (char === '[') {
            depth++;
        } else if (char === ']') {
            depth--;
            if (depth === 0) {
                return JSON.parse(payload.slice(arrayStart, i + 1));
            }
        }
    }

    throw new NotFoundError("Catalog tree in the catalog page is not complete.");
}

/**
 * Fetch all catalog categories from Vinted
 * @param {Object} params - Parameters for fetching catalog categories
 * @param {string} params.cookie - Cookie for authentication.
 * @returns {Promise<Object>} - Promise resolving to the fetched catalog categories
 */
export async function fetchCatalogInitializer({ cookie }) {
    return await executeWithDetailedHandling(async () => {
        const url = `https://www.vinted.${extension}/catalog`;

        const response = await RequestBuilder.get(url)
                        .setNextProxy()
                        .setCookie(cookie)
                        .setHeaders({ 'Accept': 'text/html,application/xhtml+xml' })
                        .setTimeout(CATALOG_PAGE_TIMEOUT_MS)
                        .send();

        if (!response.success) {
            throw new NotFoundError("Error fetching catalog items.");
        }

        return { data: { catalogs: extractCatalogsFromPayload(String(response.data)) } };
    });
}
