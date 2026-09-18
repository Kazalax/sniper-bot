// Tridy chyb urcuji, jak na chybu reaguje hlidaci smycka.
// docasna: zkusit znovu v beznem intervalu
// zahlceni: nasobit interval kanalu
// blokace: vyrazne prodlouzit interval, rychle opakovani blokaci jen udrzuje
// zruseno: prestat se ptat, adresa uz neexistuje
// jiny tvar: odpoved dorazila, ale nema ocekavana pole
export const ERROR_KIND = {
    TEMPORARY: 'temporary',
    RATE_LIMIT: 'rate_limit',
    BLOCKED: 'blocked',
    GONE: 'gone',
    SHAPE: 'shape',
};

const HTTP_RATE_LIMIT = 429;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

export class ProviderError extends Error {
    constructor(kind, message, status = 0) {
        super(message);
        this.name = 'ProviderError';
        this.kind = kind;
        this.status = status;
    }
}

export function classifyHttpStatus(status) {
    if (status === HTTP_RATE_LIMIT) return ERROR_KIND.RATE_LIMIT;
    if (status === HTTP_FORBIDDEN) return ERROR_KIND.BLOCKED;
    if (status === HTTP_NOT_FOUND) return ERROR_KIND.GONE;
    return ERROR_KIND.TEMPORARY;
}

// Ochrana proti botum vraci HTML stranku i s kodem 200, proto se kontroluje i telo.
function looksLikeChallenge(data) {
    if (typeof data !== 'string') return false;
    const lowered = data.slice(0, 2000).toLowerCase();
    return lowered.includes('<html') && (lowered.includes('please wait') || lowered.includes('enable javascript'));
}

export function fromHttpError(error) {
    const status = error.response?.status ?? 0;
    const data = error.response?.data;

    if (looksLikeChallenge(data)) {
        return new ProviderError(ERROR_KIND.BLOCKED, 'Ochrana proti botum vratila vyzvu', status);
    }

    if (status) {
        return new ProviderError(classifyHttpStatus(status), error.message || `HTTP ${status}`, status);
    }

    return new ProviderError(ERROR_KIND.TEMPORARY, error.message || 'Chyba site', 0);
}
