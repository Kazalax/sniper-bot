import Logger from '../utils/logger.js';
import { ERROR_KIND } from '../providers/errors.js';

// Kolik selhani za sebou znamena poruchu. Pri intervalu 60 s jsou to asi tri minuty.
const FAILURES_BEFORE_ALERT = 3;
const REMINDER_INTERVAL_MS = 60 * 60 * 1000;

// Zrusena adresa a zmeneny tvar odpovedi nejsou vykyv, hlasi se hned.
const REPORT_IMMEDIATELY = [ERROR_KIND.GONE, ERROR_KIND.SHAPE];

const KIND_LABEL = {
    [ERROR_KIND.TEMPORARY]: 'docasna chyba',
    [ERROR_KIND.RATE_LIMIT]: 'zahlceni',
    [ERROR_KIND.BLOCKED]: 'blokace',
    [ERROR_KIND.GONE]: 'zrusena adresa',
    [ERROR_KIND.SHAPE]: 'zmeneny tvar odpovedi',
};

function formatDuration(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) {
        return `${minutes} min`;
    }
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

class HealthReporter {
    static states = new Map();
    static send = null;
    static now = () => new Date();

    static configure({ send, now }) {
        this.send = send;
        if (now) {
            this.now = now;
        }
    }

    static reset() {
        this.states.clear();
        this.send = null;
        this.now = () => new Date();
    }

    static state(providerName) {
        if (!this.states.has(providerName)) {
            this.states.set(providerName, { failures: 0, brokenSince: null, lastReportAt: null });
        }
        return this.states.get(providerName);
    }

    static async deliver(text) {
        Logger.info(text);
        if (!this.send) {
            return;
        }

        try {
            await this.send(text);
        } catch (error) {
            // Porucha Discordu nesmi shodit hlidani.
            Logger.error(`Hlaseni se nepodarilo odeslat: ${error.message}`);
        }
    }

    static async recordFailure(providerName, error, channelCount) {
        const state = this.state(providerName);
        const now = this.now();
        state.failures += 1;

        const label = KIND_LABEL[error.kind] || 'chyba';
        const immediate = REPORT_IMMEDIATELY.includes(error.kind);

        if (!state.brokenSince && (immediate || state.failures >= FAILURES_BEFORE_ALERT)) {
            state.brokenSince = now;
            state.lastReportAt = now;
            await this.deliver(`Hlidani ${providerName} nefunguje: ${label} (${error.message}). Zasazenych kanalu: ${channelCount}.`);
            return;
        }

        if (state.brokenSince && now - state.lastReportAt >= REMINDER_INTERVAL_MS) {
            state.lastReportAt = now;
            await this.deliver(`Hlidani ${providerName} porad nefunguje (${label}), trva ${formatDuration(now - state.brokenSince)}.`);
        }
    }

    static async recordSuccess(providerName) {
        const state = this.state(providerName);
        const brokenSince = state.brokenSince;

        state.failures = 0;
        state.brokenSince = null;
        state.lastReportAt = null;

        if (brokenSince) {
            await this.deliver(`Hlidani ${providerName} obnoveno po ${formatDuration(this.now() - brokenSince)}.`);
        }
    }
}

export default HealthReporter;
