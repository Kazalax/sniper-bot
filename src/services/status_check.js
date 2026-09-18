import { allProviders, resolveProvider } from '../providers/index.js';

async function checkProvider(provider, query) {
    const startedAt = Date.now();

    try {
        if (query) {
            const items = await provider.fetchNewest(query);
            return { provider: provider.name, ok: true, count: items.length, durationMs: Date.now() - startedAt, query };
        }

        const result = await provider.smokeTest();
        return { provider: provider.name, ok: true, count: result.count, durationMs: result.durationMs };
    } catch (error) {
        return {
            provider: provider.name,
            ok: false,
            count: 0,
            durationMs: Date.now() - startedAt,
            error: error.message,
            kind: error.kind || 'neznama',
            query,
        };
    }
}

/**
 * Overi, jestli hlidane weby odpovidaji.
 * Bez URL zkontroluje vsechny weby ukazkovym dotazem, s URL jen ten jeden a
 * vrati i to, jak se URL prelozila na dotaz.
 * @param {string} [url] - URL kanalu.
 * @returns {Promise<Array<Object>>}
 */
export async function runStatusCheck(url) {
    if (!url) {
        return Promise.all(allProviders().map(provider => checkProvider(provider, null)));
    }

    const provider = resolveProvider(url);
    if (!provider) {
        return [{ provider: 'neznamy', ok: false, count: 0, durationMs: 0, error: 'Tuhle adresu nezna zadny poskytovatel', kind: 'neznama' }];
    }

    const query = provider.buildQuery(url);
    if (!provider.hasAnyFilter(query)) {
        return [{ provider: provider.name, ok: false, count: 0, durationMs: 0, error: 'URL neobsahuje zadny pouzitelny filtr', kind: 'neznama', query }];
    }

    return [await checkProvider(provider, query)];
}
