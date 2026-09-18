import Logger from "../utils/logger.js";
import { resolveProvider } from "../providers/index.js";
import { createSeenState, selectNewItems } from "./new_items.js";
import HealthReporter from "./health_reporter.js";
import { ERROR_KIND } from "../providers/errors.js";

// Nasobek intervalu podle tridy chyby. Blokaci rychle opakovani jen udrzuje,
// proto se u ni zpomaluje nejvic.
const BACKOFF_BY_KIND = {
    [ERROR_KIND.RATE_LIMIT]: 2,
    [ERROR_KIND.BLOCKED]: 5,
    [ERROR_KIND.TEMPORARY]: 1,
    [ERROR_KIND.SHAPE]: 1,
};
const MAX_BACKOFF_MULTIPLIER = 10;

/**
 * Hlida kazdy kanal zvlast a hlasi nove inzeraty.
 *
 * Kazdy kanal ma vlastni casovac a vlastni pamet videnych inzeratu, takze
 * porucha jednoho kanalu nezastavi ostatni. O tom, jak se ptat daneho webu,
 * rozhoduje poskytovatel vybrany podle URL kanalu.
 */
class ChannelMonitorService {
    static states = new Map();
    static config = null;

    /**
     * Spusti hlidani.
     * @param {Object} params - Nastaveni sluzby.
     * @param {Function} params.getChannels - Asynchronni funkce vracejici hlidane kanaly.
     * @param {number} params.intervalMs - Zakladni interval mezi kontrolami jednoho kanalu.
     * @param {Function} params.onItem - Vola se jako onItem(item, channel, provider) pro kazdy novy inzerat.
     * @returns {Promise<void>}
     */
    static async start({ getChannels, intervalMs, onItem }) {
        this.config = { getChannels, intervalMs, onItem };
        await this.refresh();
    }

    static stop() {
        for (const state of this.states.values()) {
            clearTimeout(state.timer);
        }
        this.states.clear();
    }

    /**
     * Srovna casovace se seznamem hlidanych kanalu.
     * @returns {Promise<void>}
     */
    static async refresh() {
        if (!this.config) {
            return;
        }

        let channels;
        try {
            channels = await this.config.getChannels();
        } catch (error) {
            Logger.error(`Nepodarilo se nacist hlidane kanaly: ${error.message}`);
            return;
        }

        const seen = new Set();

        for (const channel of channels) {
            const key = channel.channelId;
            seen.add(key);

            const existing = this.states.get(key);
            if (!existing) {
                this.states.set(key, {
                    channel,
                    items: createSeenState(),
                    backoffMultiplier: 1,
                    stopped: false,
                    timer: null,
                });
                this.scheduleNext(key, 0);
                continue;
            }

            // Zmenena URL znamena jine hledani, stav se zahodi.
            if (existing.channel.url !== channel.url) {
                existing.items = createSeenState();
                existing.stopped = false;
                existing.backoffMultiplier = 1;
            }
            existing.channel = channel;
        }

        for (const [key, state] of this.states) {
            if (!seen.has(key)) {
                clearTimeout(state.timer);
                this.states.delete(key);
            }
        }

        Logger.info(`Hlidam ${this.states.size} kanalu`);
    }

    static scheduleNext(key, delayMs) {
        const state = this.states.get(key);
        if (!state || state.stopped) {
            return;
        }

        const delay = delayMs ?? this.config.intervalMs * state.backoffMultiplier;
        state.timer = setTimeout(() => this.checkChannel(key), delay);
    }

    /**
     * Spocita, kolik kanalu hlida dany web. Pouziva se v hlaseni poruch.
     * @param {string} providerName - Nazev poskytovatele.
     * @returns {number}
     */
    static countChannelsOfProvider(providerName) {
        let count = 0;
        for (const state of this.states.values()) {
            const provider = resolveProvider(state.channel.url);
            if (provider && provider.name === providerName) {
                count += 1;
            }
        }
        return count;
    }

    static async checkChannel(key) {
        const state = this.states.get(key);
        if (!state) {
            return;
        }

        const provider = resolveProvider(state.channel.url);
        if (!provider) {
            Logger.warn(`Kanal ${key} ma URL, kterou nezna zadny poskytovatel, hlidani zastaveno`);
            state.stopped = true;
            return;
        }

        try {
            await this.collectNewItems(state, provider);
            state.backoffMultiplier = 1;
            await HealthReporter.recordSuccess(provider.name);
        } catch (error) {
            const kind = error.kind || ERROR_KIND.TEMPORARY;
            await HealthReporter.recordFailure(provider.name, error, this.countChannelsOfProvider(provider.name));

            // Zrusenou adresu nema smysl zkouset znovu.
            if (kind === ERROR_KIND.GONE) {
                state.stopped = true;
                Logger.error(`Kanal ${key}: ${error.message}, hlidani zastaveno`);
                return;
            }

            const factor = BACKOFF_BY_KIND[kind] ?? 1;
            state.backoffMultiplier = Math.min(state.backoffMultiplier * factor, MAX_BACKOFF_MULTIPLIER);
            Logger.error(`Kanal ${key}: ${error.message} (${kind})`);
        }

        // Kanal se planuje znovu i po chybe, jinak by ho jedno selhani zastavilo natrvalo.
        this.scheduleNext(key);
    }

    static async collectNewItems(state, provider) {
        const { channel } = state;
        const query = provider.buildQuery(channel.url);

        if (!provider.hasAnyFilter(query)) {
            Logger.warn(`Kanal ${channel.channelId} nema v URL pouzitelny filtr, preskakuji`);
            return;
        }

        if (query.dropped?.length) {
            Logger.warn(`Kanal ${channel.channelId}: zahozene parametry URL: ${query.dropped.join(', ')}`);
        }

        const items = await provider.fetchNewest(query);
        const newItems = selectNewItems(items, state.items);

        for (const item of newItems) {
            await this.config.onItem(item, channel, provider);
        }
    }
}

export default ChannelMonitorService;
