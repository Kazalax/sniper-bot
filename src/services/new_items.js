// Rozhoduje seznam videnych ID, ne cas. Hranice podle casu by natrvalo zahodila
// kazdy inzerat, ktery se objevi se starsim casem, a to je presne to vynechavani,
// ktere ma bot resit.
//
// Cas slouzi jen jako pojistka: inzerat starsi nez tolerance se neposila, aby bot
// zpetne nedoposilal veci, ktere se do vypisu dostaly jinou cestou (na Aukru treba
// placenym zvyraznenim).
export const GRACE_MS = 10 * 60 * 1000;
// Jak dlouho se drzi videna ID. Musi byt vyrazne vic nez tolerance.
const RETENTION_MS = 6 * 60 * 60 * 1000;

export function createSeenState() {
    return { seen: new Map(), newestSeenAt: null };
}

function remember(state, items, now) {
    for (const item of items) {
        state.seen.set(item.id, item.postedAt.getTime());
    }

    const newest = items.reduce(
        (max, item) => Math.max(max, item.postedAt.getTime()),
        state.newestSeenAt ? state.newestSeenAt.getTime() : 0,
    );
    if (newest > 0) {
        state.newestSeenAt = new Date(newest);
    }

    const floor = now.getTime() - RETENTION_MS;
    for (const [id, postedAtMs] of state.seen) {
        if (postedAtMs < floor) {
            state.seen.delete(id);
        }
    }
}

export function selectNewItems(items, state, now = new Date()) {
    // Prvni beh jen zapise stav, jinak by po kazdem restartu prisla davka
    // inzeratu, ktere uzivatel uz videl.
    if (state.newestSeenAt === null) {
        remember(state, items, now);
        return [];
    }

    const oldestAccepted = state.newestSeenAt.getTime() - GRACE_MS;
    const found = items
        .filter(item => !state.seen.has(item.id) && item.postedAt.getTime() >= oldestAccepted)
        .sort((a, b) => a.postedAt - b.postedAt);

    remember(state, items, now);
    return found;
}
