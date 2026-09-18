import aukroProvider from './aukro/index.js';
import vintedProvider from './vinted/index.js';

const providers = [vintedProvider, aukroProvider];

export function allProviders() {
    return providers;
}

export function resolveProvider(url) {
    return providers.find(provider => provider.matchesUrl(url)) || null;
}
