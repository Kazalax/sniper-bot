# Podpora Aukra a hlaseni poruch - implementacni plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot bude vedle Vintedu hlidat i Aukro, rozlisi druhy chyb a kazdou poruchu nahlasi do log kanalu na Discordu.

**Architecture:** Vznikne vrstva poskytovatelu (`src/providers/`), kde kazdy web umi prelozit URL na dotaz, stahnout nejnovejsi inzeraty a sestavit zpravu. Hlidaci smycka a Discord prikazy uz o webech nevedi nic. Stav hlidani sleduje hlidac poruch za web, ne za kanal.

**Tech Stack:** Node 20 (ESM), discord.js 14, axios, mongoose. Testy pres vestaveny `node --test`, zadna nova zavislost.

**Spec:** `docs/superpowers/specs/2026-09-17-aukro-provider-design.md`

## Global Constraints

- Komentare v kodu cesky bez diakritiky, stejne jako zbytek tohoto repozitare.
- Zadna nova npm zavislost. Testy pres `node --test`.
- Zadne emoji v kodu krome jiz existujicich v `item_embed.js`.
- Aukro API: `POST https://aukro.cz/backend-web/api/offers/searchItemsCommon`, hlavicka `X-Accept-Subbrand: BAZAAR`, razeni `sort=startingTime:DESC`.
- Odkaz na inzerat na Aukru: `https://aukro.cz/<seoUrl>-<itemId>`.
- Prah hlaseni poruchy: 3 neuspesne kontroly za sebou. Pripominka po 1 hodine.
- Tolerance stari u novych inzeratu: 10 minut.
- Vinted je od 2026-09-09 nedostupny (404 na `/api/v2/catalog/items`). Jeho kod se presouva, ale funkcni nebude.

---

### Task 1: Odstranit mrtvy zapis preference zemi

Bez tohoto kroku spadne `/start_monitoring` na URL z Aukra, protoze `ShippableMap[domain]` pro aukro.cz neexistuje a rozbaleni `undefined` skonci chybou.

**Files:**
- Modify: `src/bot/commands/start_monitoring.js` (radek s `setVintedChannelPreference(..., Preference.Countries, ...)`)
- Modify: `src/bot/commands/info.js` (dva vyskyty `country-whitelist`)
- Modify: `src/crud.js` (funkce `getAllMonitoredVintedChannelsBrandMap` a jeji export)

**Interfaces:**
- Consumes: nic
- Produces: `start_monitoring.js` nesaha na `ShippableMap`, takze prijme libovolnou domenu

- [ ] **Step 1: Najit vsechna mista**

```bash
grep -rn "Preference.Countries\|country-whitelist\|ShippableMap\|getAllMonitoredVintedChannelsBrandMap" src/ | grep -v node_modules
```

- [ ] **Step 2: Odstranit zapis v start_monitoring.js**

Smazat cely radek se `setVintedChannelPreference(channelId, Preference.Countries, ...)` a nepouzity import `ShippableMap`. Import `Preference` zustava, pokud ho soubor pouziva jinde.

- [ ] **Step 3: Odstranit zobrazeni v info.js**

Smazat obe casti, ktere skladaji radek `country-whitelist`. Klic v `locales/*.json` zustava, nevadi.

- [ ] **Step 4: Odstranit mrtvou funkci v crud.js**

Smazat definici `getAllMonitoredVintedChannelsBrandMap` i jeji radek v exportu.

- [ ] **Step 5: Overit, ze se vse nacte**

```bash
node --input-type=module -e "await import('./src/bot/commands/start_monitoring.js'); await import('./src/bot/commands/info.js'); await import('./src/crud.js'); console.log('ok')"
```
Ocekavane: vypise `ok`. Pripojeni k databazi se nenavazuje, staci ze modul projde.

- [ ] **Step 6: Commit**

```bash
git add src/bot/commands/start_monitoring.js src/bot/commands/info.js src/crud.js
git commit -m "fix: odstranit mrtvy zapis preference zemi"
```

---

### Task 2: Tridy chyb

**Files:**
- Create: `src/providers/errors.js`
- Test: `test/errors.test.js`

**Interfaces:**
- Produces:
  - `class ProviderError extends Error` s poli `kind`, `status`, `message`
  - `const ERROR_KIND = { TEMPORARY: 'temporary', RATE_LIMIT: 'rate_limit', BLOCKED: 'blocked', GONE: 'gone', SHAPE: 'shape' }`
  - `classifyHttpStatus(status)` vraci hodnotu z `ERROR_KIND`
  - `fromHttpError(error)` prevede chybu z axiosu na `ProviderError`

- [ ] **Step 1: Napsat padajici test**

```js
// test/errors.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError, ERROR_KIND, classifyHttpStatus, fromHttpError } from '../src/providers/errors.js';

test('zarazeni podle stavoveho kodu', () => {
    assert.equal(classifyHttpStatus(429), ERROR_KIND.RATE_LIMIT);
    assert.equal(classifyHttpStatus(403), ERROR_KIND.BLOCKED);
    assert.equal(classifyHttpStatus(404), ERROR_KIND.GONE);
    assert.equal(classifyHttpStatus(500), ERROR_KIND.TEMPORARY);
    assert.equal(classifyHttpStatus(503), ERROR_KIND.TEMPORARY);
});

test('chyba site je docasna', () => {
    const err = fromHttpError(Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }));
    assert.equal(err.kind, ERROR_KIND.TEMPORARY);
    assert.ok(err instanceof ProviderError);
});

test('odpoved s HTML vyzvou je blokace i pri kodu 200', () => {
    const err = fromHttpError({ response: { status: 200, data: '<html><title>Please wait</title></html>' } });
    assert.equal(err.kind, ERROR_KIND.BLOCKED);
});

test('ProviderError nese stavovy kod', () => {
    const err = new ProviderError(ERROR_KIND.GONE, 'Not found', 404);
    assert.equal(err.status, 404);
    assert.equal(err.kind, 'gone');
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/errors.test.js`
Ocekavane: FAIL, modul `src/providers/errors.js` neexistuje.

- [ ] **Step 3: Implementovat**

```js
// src/providers/errors.js

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
```

- [ ] **Step 4: Spustit test**

Run: `node --test test/errors.test.js`
Ocekavane: PASS, 4 testy.

- [ ] **Step 5: Commit**

```bash
git add src/providers/errors.js test/errors.test.js
git commit -m "feat: tridy chyb pro poskytovatele"
```

---

### Task 3: Preklad URL Aukra na dotaz

**Files:**
- Create: `src/providers/aukro/url.js`
- Test: `test/aukro_url.test.js`

**Interfaces:**
- Consumes: nic
- Produces:
  - `matchesUrl(url)` vraci `true` pro domenu aukro.cz
  - `buildQuery(url)` vraci `{ body, dropped }` nebo `null` pro nepouzitelnou URL; `body` je telo dotazu, `dropped` je pole nazvu zahozenych parametru
  - `hasAnyFilter(query)` vraci `true`, kdyz dotaz neco zuzuje

- [ ] **Step 1: Napsat padajici test**

```js
// test/aukro_url.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesUrl, buildQuery, hasAnyFilter } from '../src/providers/aukro/url.js';

test('pozna svou domenu', () => {
    assert.equal(matchesUrl('https://aukro.cz/panske-mikiny'), true);
    assert.equal(matchesUrl('https://www.aukro.cz/panske-mikiny'), true);
    assert.equal(matchesUrl('https://www.vinted.cz/catalog?catalog[]=1231'), false);
});

test('cesta se stane kategorii', () => {
    const { body } = buildQuery('https://aukro.cz/panske-mikiny');
    assert.equal(body.categorySeoUrl, 'panske-mikiny');
});

test('prebira povolene parametry', () => {
    const { body } = buildQuery('https://aukro.cz/panske-mikiny?text=nike&priceMin=200&priceMax=800');
    assert.equal(body.text, 'nike');
    assert.equal(body.priceMin, 200);
    assert.equal(body.priceMax, 800);
});

test('neznamy parametr zahodi a ohlasi', () => {
    const { body, dropped } = buildQuery('https://aukro.cz/panske-mikiny?priceTo=100&sort=price:ASC');
    assert.equal(body.priceTo, undefined);
    assert.deepEqual(dropped.sort(), ['priceTo', 'sort']);
});

test('nepouzitelna URL vraci null', () => {
    assert.equal(buildQuery('tohle neni url'), null);
});

test('URL bez filtru se pozna', () => {
    assert.equal(hasAnyFilter(buildQuery('https://aukro.cz/panske-mikiny')), true);
    assert.equal(hasAnyFilter(buildQuery('https://aukro.cz/')), false);
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/aukro_url.test.js`
Ocekavane: FAIL, modul neexistuje.

- [ ] **Step 3: Implementovat**

```js
// src/providers/aukro/url.js
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
```

- [ ] **Step 4: Spustit test**

Run: `node --test test/aukro_url.test.js`
Ocekavane: PASS, 6 testu.

- [ ] **Step 5: Commit**

```bash
git add src/providers/aukro/url.js test/aukro_url.test.js
git commit -m "feat: preklad URL Aukra na dotaz"
```

---

### Task 4: Prevod inzeratu Aukra na spolecny tvar

**Files:**
- Create: `src/providers/aukro/item.js`
- Test: `test/aukro_item.test.js`

**Interfaces:**
- Consumes: `ERROR_KIND`, `ProviderError` z Tasku 2
- Produces: `toMonitoredItem(raw)` vraci `{ id, title, description, brand, url, postedAt, raw }`; u chybejiciho `itemId` nebo `startingTime` vyhodi `ProviderError` tridy `shape`

- [ ] **Step 1: Napsat padajici test**

```js
// test/aukro_item.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { toMonitoredItem } from '../src/providers/aukro/item.js';
import { ERROR_KIND } from '../src/providers/errors.js';

const RAW = {
    itemId: 7133849979,
    itemName: 'Zakladni mikina',
    seoUrl: 'zakladni-mikina',
    startingTime: '2026-09-16T20:24:02.572+02:00',
    endingTime: '2026-09-23T20:23:22+02:00',
    auction: true,
    buyNowActive: true,
    price: { amount: 745, currency: 'CZK' },
    priceWithShipping: { amount: 844, currency: 'CZK' },
    titleImageUrl: 'https://cdn.aukro.cz/images/x/zakladni-mikina.jpeg',
    location: 'Komjatna',
    attributes: [
        { attributeName: 'Stav zbozi', attributeValue: 'Zanovni' },
        { attributeName: 'Znacka', attributeValue: 'Nike' },
    ],
    seller: { showName: 'matiasb4', positiveFeedbackPercentage: 98.5, feedbackUniqueUserCount: 40 },
};

test('sestavi odkaz ze seoUrl a ID', () => {
    const item = toMonitoredItem(RAW);
    assert.equal(item.url, 'https://aukro.cz/zakladni-mikina-7133849979');
    assert.equal(item.id, '7133849979');
});

test('prevezme nazev, znacku a cas vlozeni', () => {
    const item = toMonitoredItem(RAW);
    assert.equal(item.title, 'Zakladni mikina');
    assert.equal(item.brand, 'Nike');
    assert.equal(item.postedAt.toISOString(), new Date('2026-09-16T20:24:02.572+02:00').toISOString());
});

test('inzerat bez ID je chyba tvaru', () => {
    assert.throws(() => toMonitoredItem({ itemName: 'bez id' }), error => error.kind === ERROR_KIND.SHAPE);
});

test('chybejici znacka nevadi', () => {
    const item = toMonitoredItem({ ...RAW, attributes: [] });
    assert.equal(item.brand, '');
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/aukro_item.test.js`
Ocekavane: FAIL, modul neexistuje.

- [ ] **Step 3: Implementovat**

```js
// src/providers/aukro/item.js
import { ProviderError, ERROR_KIND } from '../errors.js';

const ITEM_BASE_URL = 'https://aukro.cz';

function attribute(raw, name) {
    const found = (raw.attributes || []).find(entry => entry.attributeName === name);
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
```

- [ ] **Step 4: Spustit test**

Run: `node --test test/aukro_item.test.js`
Ocekavane: PASS, 4 testy.

- [ ] **Step 5: Commit**

```bash
git add src/providers/aukro/item.js test/aukro_item.test.js
git commit -m "feat: prevod inzeratu Aukra na spolecny tvar"
```

---

### Task 5: Dotaz na Aukro

**Files:**
- Create: `src/providers/aukro/api.js`
- Test: `test/aukro_api.test.js`

**Interfaces:**
- Consumes: `toMonitoredItem` z Tasku 4, `fromHttpError` a `ProviderError` z Tasku 2
- Produces: `fetchNewest(query, limit)` vraci pole polozek ve spolecnem tvaru, serazene od nejnovejsi; chyby vyhazuje jako `ProviderError`

- [ ] **Step 1: Napsat padajici test**

Test se pta zivého API, protoze Aukro nepotrebuje prihlaseni. Kdyz sit neni k dispozici, test se preskoci, aby nepadal bez duvodu.

```js
// test/aukro_api.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNewest } from '../src/providers/aukro/api.js';

test('vrati nejnovejsi inzeraty serazene od nejnovejsiho', async (t) => {
    let items;
    try {
        items = await fetchNewest({ body: { categorySeoUrl: 'panske-mikiny' } }, 5);
    } catch (error) {
        t.skip(`Aukro neni dostupne: ${error.message}`);
        return;
    }

    assert.ok(items.length > 0);
    assert.ok(items[0].url.startsWith('https://aukro.cz/'));
    for (let i = 1; i < items.length; i++) {
        assert.ok(items[i - 1].postedAt >= items[i].postedAt, 'poradi podle casu');
    }
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/aukro_api.test.js`
Ocekavane: FAIL, modul neexistuje.

- [ ] **Step 3: Implementovat**

```js
// src/providers/aukro/api.js
import axios from 'axios';
import { toMonitoredItem } from './item.js';
import { fromHttpError, ProviderError, ERROR_KIND } from '../errors.js';

const SEARCH_URL = 'https://aukro.cz/backend-web/api/offers/searchItemsCommon';
const REQUEST_TIMEOUT_MS = 15000;
// Razeni je vzdy od nejnovejsich, jinak Aukro radi podle relevance.
const SORT_NEWEST = 'startingTime:DESC';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

export async function fetchNewest(query, limit) {
    let response;

    try {
        response = await axios.post(SEARCH_URL, query.body, {
            params: { page: 0, size: limit, sort: SORT_NEWEST },
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Accept-Subbrand': 'BAZAAR',
                'User-Agent': USER_AGENT,
            },
        });
    } catch (error) {
        throw fromHttpError(error);
    }

    if (!response.data || !Array.isArray(response.data.content)) {
        throw new ProviderError(ERROR_KIND.SHAPE, 'Odpoved Aukra nema pole content', response.status);
    }

    return response.data.content.map(toMonitoredItem);
}
```

- [ ] **Step 4: Spustit test**

Run: `node --test test/aukro_api.test.js`
Ocekavane: PASS (nebo preskoceni, kdyz neni sit).

- [ ] **Step 5: Commit**

```bash
git add src/providers/aukro/api.js test/aukro_api.test.js
git commit -m "feat: dotaz na vyhledavani Aukra"
```

---

### Task 6: Zprava do Discordu pro Aukro

**Files:**
- Create: `src/providers/aukro/embed.js`
- Test: `test/aukro_embed.test.js`

**Interfaces:**
- Consumes: polozku z Tasku 4, `createBaseEmbed` a `createBaseUrlButton` z `src/bot/components/base_embeds.js`
- Produces: `buildMessage(item)` vraci `{ embeds, components }`

- [ ] **Step 1: Napsat padajici test**

```js
// test/aukro_embed.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage } from '../src/providers/aukro/embed.js';
import { toMonitoredItem } from '../src/providers/aukro/item.js';

const RAW = {
    itemId: 1, itemName: 'Mikina', seoUrl: 'mikina',
    startingTime: '2026-09-16T20:24:02+02:00', endingTime: '2026-09-23T20:23:22+02:00',
    auction: true, price: { amount: 745, currency: 'CZK' },
    priceWithShipping: { amount: 844, currency: 'CZK' },
    titleImageUrl: 'https://cdn.aukro.cz/x.jpeg', location: 'Brno',
    attributes: [{ attributeName: 'Stav zbozi', attributeValue: 'Zanovni' }],
    seller: { showName: 'prodejce', positiveFeedbackPercentage: 98.5, feedbackUniqueUserCount: 40 },
};

test('zprava obsahuje cenu a odkaz', async () => {
    const { embeds, components } = await buildMessage(toMonitoredItem(RAW));
    const data = embeds[0].toJSON();
    assert.equal(data.url, 'https://aukro.cz/mikina-1');
    assert.ok(data.fields.some(field => field.value.includes('745')));
    assert.equal(components.length, 1);
});

test('zadne pole nema prazdnou hodnotu', async () => {
    const raw = { ...RAW, location: '', attributes: [], seller: {} };
    const { embeds } = await buildMessage(toMonitoredItem(raw));
    for (const field of embeds[0].toJSON().fields) {
        assert.ok(field.value.trim().length > 0, `prazdne pole ${field.name}`);
    }
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/aukro_embed.test.js`
Ocekavane: FAIL, modul neexistuje.

- [ ] **Step 3: Implementovat**

```js
// src/providers/aukro/embed.js
import { ActionRowBuilder } from 'discord.js';
import { createBaseEmbed, createBaseUrlButton } from '../../bot/components/base_embeds.js';

const EMBED_COLOR = '#0f7c3f';

function price(value) {
    return value && value.amount ? `${value.amount} ${value.currency}` : '';
}

function attribute(raw, name) {
    const found = (raw.attributes || []).find(entry => entry.attributeName === name);
    return found ? found.attributeValue : '';
}

function seller(raw) {
    const data = raw.seller || {};
    if (!data.showName) return '';
    if (!data.feedbackUniqueUserCount) return data.showName;
    return `${data.showName} (${Math.round(data.positiveFeedbackPercentage)} % z ${data.feedbackUniqueUserCount})`;
}

export async function buildMessage(item) {
    const raw = item.raw;
    const embed = await createBaseEmbed(null, item.title, ' ', EMBED_COLOR);
    embed.setURL(item.url);

    const fields = [
        { name: 'Cena', value: price(raw.price), inline: true },
        { name: 'S postovnym', value: price(raw.priceWithShipping), inline: true },
        { name: 'Stav', value: attribute(raw, 'Stav zbozi'), inline: true },
        { name: 'Znacka', value: item.brand, inline: true },
        { name: 'Lokalita', value: raw.location || '', inline: true },
        { name: 'Prodejce', value: seller(raw), inline: true },
    ];

    // Aukce se lisi tim, ze konci, proto se doplni cas konce.
    if (raw.auction && raw.endingTime) {
        const endsAt = Math.floor(new Date(raw.endingTime).getTime() / 1000);
        fields.push({ name: 'Aukce konci', value: `<t:${endsAt}:R>`, inline: true });
    }

    // Discord odmita pole s prazdnou hodnotou.
    embed.setFields(fields.filter(field => field.value && field.value.trim().length > 0));

    if (raw.titleImageUrl) {
        embed.setImage(raw.titleImageUrl);
    }

    const actionRow = new ActionRowBuilder();
    actionRow.addComponents(await createBaseUrlButton('Zobrazit na Aukru', item.url));

    return { embeds: [embed], components: [actionRow] };
}
```

- [ ] **Step 4: Spustit test**

Run: `node --test test/aukro_embed.test.js`
Ocekavane: PASS, 2 testy.

- [ ] **Step 5: Commit**

```bash
git add src/providers/aukro/embed.js test/aukro_embed.test.js
git commit -m "feat: zprava do Discordu pro inzeraty Aukra"
```

---

### Task 7: Registr poskytovatelu a poskytovatel Aukro

**Files:**
- Create: `src/providers/aukro/index.js`
- Create: `src/providers/index.js`
- Test: `test/providers.test.js`

**Interfaces:**
- Consumes: moduly z Tasku 3 az 6
- Produces:
  - poskytovatel je objekt `{ name, matchesUrl, buildQuery, hasAnyFilter, init, fetchNewest, buildMessage, smokeTest }`
  - `resolveProvider(url)` vraci poskytovatele nebo `null`
  - `allProviders()` vraci pole vsech poskytovatelu

- [ ] **Step 1: Napsat padajici test**

```js
// test/providers.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, allProviders } from '../src/providers/index.js';

test('podle URL vybere spravneho poskytovatele', () => {
    assert.equal(resolveProvider('https://aukro.cz/panske-mikiny').name, 'aukro');
    assert.equal(resolveProvider('https://www.vinted.cz/catalog?catalog[]=1231').name, 'vinted');
    assert.equal(resolveProvider('https://example.com/neco'), null);
});

test('kazdy poskytovatel ma cele rozhrani', () => {
    for (const provider of allProviders()) {
        for (const method of ['matchesUrl', 'buildQuery', 'hasAnyFilter', 'init', 'fetchNewest', 'buildMessage', 'smokeTest']) {
            assert.equal(typeof provider[method], 'function', `${provider.name} nema ${method}`);
        }
    }
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/providers.test.js`
Ocekavane: FAIL, moduly neexistuji.

- [ ] **Step 3: Implementovat poskytovatele Aukro**

```js
// src/providers/aukro/index.js
import { matchesUrl, buildQuery, hasAnyFilter } from './url.js';
import { fetchNewest } from './api.js';
import { buildMessage } from './embed.js';

// Kolik inzeratu se stahuje pri jedne kontrole. V kategorii obleceni pokrylo
// 180 inzeratu 54 hodin provozu, takze rezerva proti vynechani je velka.
const ITEMS_PER_REQUEST = 60;
const SMOKE_TEST_QUERY = { body: { categorySeoUrl: 'panske-mikiny' } };

const aukroProvider = {
    name: 'aukro',
    matchesUrl,
    buildQuery,
    hasAnyFilter,

    // Aukro nepotrebuje prihlaseni ani relaci.
    async init() {},

    async fetchNewest(query) {
        return fetchNewest(query, ITEMS_PER_REQUEST);
    },

    async buildMessage(item) {
        return buildMessage(item);
    },

    async smokeTest() {
        const startedAt = Date.now();
        const items = await fetchNewest(SMOKE_TEST_QUERY, 5);
        return { count: items.length, durationMs: Date.now() - startedAt };
    },
};

export default aukroProvider;
```

- [ ] **Step 4: Implementovat registr**

```js
// src/providers/index.js
import aukroProvider from './aukro/index.js';
import vintedProvider from './vinted/index.js';

const providers = [vintedProvider, aukroProvider];

export function allProviders() {
    return providers;
}

export function resolveProvider(url) {
    return providers.find(provider => provider.matchesUrl(url)) || null;
}
```

- [ ] **Step 5: Spustit test**

Run: `node --test test/providers.test.js`
Ocekavane: FAIL na chybejicim `./vinted/index.js`. To je v poradku, doplni se v dalsim tasku. Test se spusti znovu na konci Tasku 8.

- [ ] **Step 6: Commit**

```bash
git add src/providers/aukro/index.js src/providers/index.js test/providers.test.js
git commit -m "feat: poskytovatel Aukro a registr poskytovatelu"
```

---

### Task 8: Presunout Vinted do vrstvy poskytovatelu

Kod Vintedu se presouva tak jak je, vcetne obnovovaci smycky cookie, ktera dnes zije v `main.js`. Vinted je od 2026-09-09 nedostupny, takze se od nej ocekava chyba tridy `gone`.

**Files:**
- Create: `src/providers/vinted/index.js`
- Modify: `src/bot/components/item_embed.js` (jen doplnit export, kod zustava)
- Test: `test/providers.test.js` (jiz existuje z Tasku 7)

**Interfaces:**
- Consumes: `fetchCookie`, `fetchCatalogItems`, `fetchItemDetail`, `VintedItem`, `buildApiFiltersFromUrl`, `hasAnyFilter`, `createVintedItemEmbed`, `createVintedItemActionRow`
- Produces: poskytovatel `vinted` se stejnym rozhranim jako Aukro; drzi si cookie sam

- [ ] **Step 1: Implementovat poskytovatele**

```js
// src/providers/vinted/index.js
import { URL } from 'url';
import Logger from '../../utils/logger.js';
import ConfigurationManager from '../../utils/config_manager.js';
import { fetchCookie } from '../../api/fetchCookie.js';
import { fetchCatalogItems } from '../../api/fetchCatalogItems.js';
import { fetchItemDetail } from '../../api/fetchItemDetail.js';
import { VintedItem } from '../../entities/vinted_item.js';
import { buildApiFiltersFromUrl, hasAnyFilter as hasAnyVintedFilter } from '../../services/url_service.js';
import { createVintedItemEmbed, createVintedItemActionRow } from '../../bot/components/item_embed.js';
import { fromHttpError } from '../errors.js';

const ITEMS_PER_REQUEST = 20;
const COOKIE_REFRESH_INTERVAL_MS = 60000;

// Prihlaseni je vec poskytovatele, ne hlidaci smycky. Aukro zadnou relaci nema.
let cookie = null;

async function refreshCookie() {
    try {
        const fetched = await fetchCookie();
        if (fetched.cookie) {
            cookie = fetched.cookie;
            Logger.debug('Cookie Vintedu obnovena');
        }
    } catch (error) {
        Logger.debug('Cookie Vintedu se nepodarilo obnovit');
    }
}

function domainFromUrl(url) {
    const match = url.match(/vinted\.([a-z.]+?)\//);
    return match ? match[1] : ConfigurationManager.getAlgorithmSetting.vinted_api_domain_extension;
}

const vintedProvider = {
    name: 'vinted',

    matchesUrl(url) {
        try {
            return new URL(url).hostname.includes('vinted.');
        } catch (error) {
            return false;
        }
    },

    buildQuery(url) {
        const filters = buildApiFiltersFromUrl(url);
        return filters ? { filters, url } : null;
    },

    hasAnyFilter(query) {
        return Boolean(query) && hasAnyVintedFilter(query.filters);
    },

    async init() {
        await refreshCookie();
        setInterval(refreshCookie, COOKIE_REFRESH_INTERVAL_MS);
    },

    async fetchNewest(query) {
        const response = await fetchCatalogItems({ cookie, filters: query.filters, per_page: ITEMS_PER_REQUEST });

        if (!response.success) {
            throw fromHttpError({
                response: { status: response.code || 0 },
                message: response.error || 'Chyba katalogu Vintedu',
            });
        }

        const items = [];
        for (const raw of response.items || []) {
            const item = new VintedItem(raw);
            const detail = await fetchItemDetail({ cookie, url: item.url });
            item.mergeDetail(detail);
            items.push({
                id: String(item.id),
                title: item.title,
                description: item.description === 'N/A' ? '' : item.description,
                brand: item.brand === 'N/A' ? '' : item.brand,
                url: item.url,
                postedAt: new Date(item.unixUpdatedAt * 1000),
                raw: item,
            });
        }

        return items;
    },

    async buildMessage(item, channel) {
        const domain = domainFromUrl(channel?.url || item.url);
        const { embed, photosEmbeds } = await createVintedItemEmbed(item.raw, domain);
        const actionRow = await createVintedItemActionRow(item.raw, domain);
        return { embeds: [embed, ...photosEmbeds], components: [actionRow] };
    },

    async smokeTest() {
        const startedAt = Date.now();
        const response = await fetchCatalogItems({ cookie, filters: { catalog_ids: ['1231'] }, per_page: 5 });
        if (!response.success) {
            throw fromHttpError({ response: { status: response.code || 0 }, message: response.error });
        }
        return { count: (response.items || []).length, durationMs: Date.now() - startedAt };
    },
};

export default vintedProvider;
```

- [ ] **Step 2: Spustit testy poskytovatelu**

Run: `node --test test/providers.test.js`
Ocekavane: PASS, 2 testy.

- [ ] **Step 3: Commit**

```bash
git add src/providers/vinted/index.js
git commit -m "feat: presunout Vinted do vrstvy poskytovatelu"
```

---

### Task 9: Poznani novych inzeratu podle ID a stari

**Files:**
- Create: `src/services/new_items.js`
- Test: `test/new_items.test.js`

**Interfaces:**
- Consumes: polozky ve spolecnem tvaru
- Produces:
  - `createSeenState()` vraci `{ seen: Map, newestSeenAt: null }`
  - `selectNewItems(items, state, now)` vraci pole novych polozek serazenych od nejstarsi a rovnou aktualizuje stav
  - `GRACE_MS` je tolerance stari 10 minut

- [ ] **Step 1: Napsat padajici test**

```js
// test/new_items.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeenState, selectNewItems } from '../src/services/new_items.js';

const minutesAgo = (base, minutes) => new Date(base.getTime() - minutes * 60000);
const NOW = new Date('2026-09-18T12:00:00Z');

function item(id, postedAt) {
    return { id, title: `polozka ${id}`, description: '', brand: '', url: `https://aukro.cz/x-${id}`, postedAt, raw: {} };
}

test('prvni beh nic neposle, jen si zapamatuje stav', () => {
    const state = createSeenState();
    const found = selectNewItems([item('1', minutesAgo(NOW, 1)), item('2', minutesAgo(NOW, 2))], state, NOW);
    assert.deepEqual(found, []);
    assert.equal(state.seen.size, 2);
});

test('nove ID se posle, zname uz ne', () => {
    const state = createSeenState();
    selectNewItems([item('1', minutesAgo(NOW, 5))], state, NOW);
    const found = selectNewItems([item('2', minutesAgo(NOW, 1)), item('1', minutesAgo(NOW, 5))], state, NOW);
    assert.deepEqual(found.map(entry => entry.id), ['2']);
});

test('stejny inzerat podruhe uz neprijde', () => {
    const state = createSeenState();
    selectNewItems([item('1', minutesAgo(NOW, 5))], state, NOW);
    selectNewItems([item('2', minutesAgo(NOW, 1))], state, NOW);
    const found = selectNewItems([item('2', minutesAgo(NOW, 1))], state, NOW);
    assert.deepEqual(found, []);
});

test('stary inzerat nove zarazeny do vypisu se neposle', () => {
    const state = createSeenState();
    selectNewItems([item('1', minutesAgo(NOW, 1))], state, NOW);
    const found = selectNewItems([item('stary', minutesAgo(NOW, 600)), item('1', minutesAgo(NOW, 1))], state, NOW);
    assert.deepEqual(found, []);
});

test('vysledek je serazeny od nejstarsiho', () => {
    const state = createSeenState();
    selectNewItems([item('1', minutesAgo(NOW, 9))], state, NOW);
    const found = selectNewItems([
        item('3', minutesAgo(NOW, 1)),
        item('2', minutesAgo(NOW, 4)),
        item('1', minutesAgo(NOW, 9)),
    ], state, NOW);
    assert.deepEqual(found.map(entry => entry.id), ['2', '3']);
});

test('stara ID se ze seznamu zahazuji', () => {
    const state = createSeenState();
    selectNewItems([item('stare', minutesAgo(NOW, 600))], state, NOW);
    selectNewItems([item('nove', NOW)], state, NOW);
    assert.equal(state.seen.has('stare'), false);
    assert.equal(state.seen.has('nove'), true);
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/new_items.test.js`
Ocekavane: FAIL, modul neexistuje.

- [ ] **Step 3: Implementovat**

```js
// src/services/new_items.js

// Rozhoduje seznam videnych ID, ne cas. Hranice podle casu by natrvalo zahodila
// kazdy inzerat, ktery se objevi se starsim casem, a to je presne to vynechavani,
// ktere ma bot resit.
//
// Cas slouzi jen jako pojistka: inzerat starsi nez tolerance se neposila, aby bot
// zpetne nedoposilal veci, ktere se do vypisu dostaly jinou cestou.
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

    const newest = items.reduce((max, item) => Math.max(max, item.postedAt.getTime()), state.newestSeenAt?.getTime() ?? 0);
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
```

- [ ] **Step 4: Spustit test**

Run: `node --test test/new_items.test.js`
Ocekavane: PASS, 6 testu.

- [ ] **Step 5: Commit**

```bash
git add src/services/new_items.js test/new_items.test.js
git commit -m "feat: poznani novych inzeratu podle ID a stari"
```

---

### Task 10: Hlidac poruch

**Files:**
- Create: `src/services/health_reporter.js`
- Test: `test/health_reporter.test.js`

**Interfaces:**
- Consumes: `ERROR_KIND` a `ProviderError` z Tasku 2
- Produces:
  - `HealthReporter.configure({ send, now })` kde `send(text)` posila zpravu a `now()` vraci cas
  - `HealthReporter.recordFailure(providerName, error, channelCount)`
  - `HealthReporter.recordSuccess(providerName)`
  - `HealthReporter.reset()` pro testy

- [ ] **Step 1: Napsat padajici test**

```js
// test/health_reporter.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import HealthReporter from '../src/services/health_reporter.js';
import { ProviderError, ERROR_KIND } from '../src/providers/errors.js';

function setup() {
    const sent = [];
    let clock = new Date('2026-09-18T12:00:00Z').getTime();
    HealthReporter.reset();
    HealthReporter.configure({
        send: async text => { sent.push(text); },
        now: () => new Date(clock),
    });
    return { sent, advance: minutes => { clock += minutes * 60000; } };
}

test('mlci, dokud nejsou tri selhani za sebou', async () => {
    const { sent } = setup();
    const error = new ProviderError(ERROR_KIND.TEMPORARY, 'timeout');
    await HealthReporter.recordFailure('aukro', error, 2);
    await HealthReporter.recordFailure('aukro', error, 2);
    assert.equal(sent.length, 0);
    await HealthReporter.recordFailure('aukro', error, 2);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /aukro/);
});

test('zrusena adresa se hlasi hned', async () => {
    const { sent } = setup();
    await HealthReporter.recordFailure('vinted', new ProviderError(ERROR_KIND.GONE, 'Not found', 404), 3);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /zrusen/i);
});

test('pripomina jednou za hodinu', async () => {
    const { sent, advance } = setup();
    const error = new ProviderError(ERROR_KIND.BLOCKED, 'blokace', 403);
    for (let i = 0; i < 3; i++) await HealthReporter.recordFailure('aukro', error, 1);
    assert.equal(sent.length, 1);

    advance(30);
    await HealthReporter.recordFailure('aukro', error, 1);
    assert.equal(sent.length, 1, 'do hodiny nic navic');

    advance(31);
    await HealthReporter.recordFailure('aukro', error, 1);
    assert.equal(sent.length, 2);
});

test('obnoveni se hlasi i s dobou vypadku', async () => {
    const { sent, advance } = setup();
    const error = new ProviderError(ERROR_KIND.TEMPORARY, 'timeout');
    for (let i = 0; i < 3; i++) await HealthReporter.recordFailure('aukro', error, 1);
    advance(90);
    await HealthReporter.recordSuccess('aukro');
    assert.equal(sent.length, 2);
    assert.match(sent[1], /obnoven/i);
    assert.match(sent[1], /1 h 30 min/);
});

test('uspech bez predchozi poruchy nic neposila', async () => {
    const { sent } = setup();
    await HealthReporter.recordSuccess('aukro');
    assert.equal(sent.length, 0);
});

test('bez nastaveneho odesilani to nespadne', async () => {
    HealthReporter.reset();
    await HealthReporter.recordFailure('aukro', new ProviderError(ERROR_KIND.GONE, 'pryc', 404), 1);
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/health_reporter.test.js`
Ocekavane: FAIL, modul neexistuje.

- [ ] **Step 3: Implementovat**

```js
// src/services/health_reporter.js
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
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

class HealthReporter {
    static states = new Map();
    static send = null;
    static now = () => new Date();

    static configure({ send, now }) {
        this.send = send;
        if (now) this.now = now;
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
        if (!this.send) return;

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

        const immediate = REPORT_IMMEDIATELY.includes(error.kind);
        const reachedThreshold = state.failures >= FAILURES_BEFORE_ALERT;

        if (!state.brokenSince && (immediate || reachedThreshold)) {
            state.brokenSince = now;
            state.lastReportAt = now;
            const label = KIND_LABEL[error.kind] || 'chyba';
            await this.deliver(`Hlidani ${providerName} nefunguje: ${label} (${error.message}). Zasazenych kanalu: ${channelCount}.`);
            return;
        }

        if (state.brokenSince && now - state.lastReportAt >= REMINDER_INTERVAL_MS) {
            state.lastReportAt = now;
            const label = KIND_LABEL[error.kind] || 'chyba';
            await this.deliver(`Hlidani ${providerName} porad nefunguje (${label}), trva ${formatDuration(now - state.brokenSince)}.`);
        }
    }

    static async recordSuccess(providerName) {
        const state = this.state(providerName);
        const wasBroken = state.brokenSince;
        state.failures = 0;
        state.brokenSince = null;
        state.lastReportAt = null;

        if (wasBroken) {
            await this.deliver(`Hlidani ${providerName} obnoveno po ${formatDuration(this.now() - wasBroken)}.`);
        }
    }
}

export default HealthReporter;
```

- [ ] **Step 4: Spustit test**

Run: `node --test test/health_reporter.test.js`
Ocekavane: PASS, 6 testu.

- [ ] **Step 5: Commit**

```bash
git add src/services/health_reporter.js test/health_reporter.test.js
git commit -m "feat: hlidac poruch s hlasenim do Discordu"
```

---

### Task 11: Hlidaci smycka pres poskytovatele

**Files:**
- Modify: `src/services/channel_monitor_service.js` (cely soubor se prepise)
- Test: rucne v Tasku 14

**Interfaces:**
- Consumes: `resolveProvider` z Tasku 7, `createSeenState` a `selectNewItems` z Tasku 9, `HealthReporter` z Tasku 10
- Produces: `ChannelMonitorService.start({ getChannels, intervalMs, onItem })`, `refresh()`, `stop()`

- [ ] **Step 1: Prepsat sluzbu**

```js
// src/services/channel_monitor_service.js
import Logger from "../utils/logger.js";
import { resolveProvider } from "../providers/index.js";
import { createSeenState, selectNewItems } from "./new_items.js";
import HealthReporter from "./health_reporter.js";
import { ERROR_KIND } from "../providers/errors.js";

// Nasobek intervalu podle tridy chyby. Blokaci rychle opakovani jen udrzuje.
const BACKOFF_BY_KIND = {
    [ERROR_KIND.RATE_LIMIT]: 2,
    [ERROR_KIND.BLOCKED]: 5,
    [ERROR_KIND.TEMPORARY]: 1,
    [ERROR_KIND.SHAPE]: 1,
};
const MAX_BACKOFF_MULTIPLIER = 10;

class ChannelMonitorService {
    static states = new Map();
    static config = null;

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

    static async refresh() {
        if (!this.config) return;

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
                this.states.set(key, { channel, items: createSeenState(), backoffMultiplier: 1, stopped: false, timer: null });
                this.scheduleNext(key, 0);
                continue;
            }

            // Zmenena URL znamena jine hledani, stav se zahodi.
            if (existing.channel.url !== channel.url) {
                existing.items = createSeenState();
                existing.stopped = false;
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
        if (!state || state.stopped) return;

        const delay = delayMs ?? this.config.intervalMs * state.backoffMultiplier;
        state.timer = setTimeout(() => this.checkChannel(key), delay);
    }

    static countChannelsOfProvider(providerName) {
        let count = 0;
        for (const state of this.states.values()) {
            const provider = resolveProvider(state.channel.url);
            if (provider && provider.name === providerName) count += 1;
        }
        return count;
    }

    static async checkChannel(key) {
        const state = this.states.get(key);
        if (!state) return;

        const provider = resolveProvider(state.channel.url);
        if (!provider) {
            Logger.warn(`Kanal ${key} ma URL, kterou nezna zadny poskytovatel, preskakuji`);
            return;
        }

        try {
            await this.collectNewItems(state, provider);
            state.backoffMultiplier = 1;
            await HealthReporter.recordSuccess(provider.name);
        } catch (error) {
            const kind = error.kind || ERROR_KIND.TEMPORARY;
            await HealthReporter.recordFailure(provider.name, error, this.countChannelsOfProvider(provider.name));

            // Zrusena adresa se nema smysl ptat znovu.
            if (kind === ERROR_KIND.GONE) {
                state.stopped = true;
                Logger.error(`Kanal ${key}: ${error.message}, hlidani zastaveno`);
                return;
            }

            const factor = BACKOFF_BY_KIND[kind] ?? 1;
            state.backoffMultiplier = Math.min(state.backoffMultiplier * factor, MAX_BACKOFF_MULTIPLIER);
            Logger.error(`Kanal ${key}: ${error.message} (${kind})`);
        }

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
```

- [ ] **Step 2: Overit, ze se modul nacte**

```bash
node --input-type=module -e "await import('./src/services/channel_monitor_service.js'); console.log('ok')"
```
Ocekavane: `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/services/channel_monitor_service.js
git commit -m "feat: hlidaci smycka pres poskytovatele"
```

---

### Task 12: Zapojeni v main.js a log kanal v nastaveni

**Files:**
- Modify: `main.js`
- Modify: `src/utils/config_manager.js`
- Modify: `.env` na Pi (v Tasku 14)

**Interfaces:**
- Consumes: vse z predchozich tasku
- Produces: `ConfigurationManager.getDiscordConfig.log_channel_id`

- [ ] **Step 1: Doplnit nastaveni**

V `src/utils/config_manager.js` do objektu s Discord nastavenim pridat:

```js
            log_channel_id: process.env.DISCORD_LOG_CHANNEL_ID || '',
```

- [ ] **Step 2: Prepsat main.js**

```js
// main.js
import ProxyManager from "./src/utils/proxy_manager.js";
import { Preference } from "./src/database.js";
import client from "./src/client.js";
import ConfigurationManager from "./src/utils/config_manager.js";
import { postMessageToChannel, checkVintedChannelInactivity } from "./src/services/discord_service.js";
import crud from "./src/crud.js";
import Logger from "./src/utils/logger.js";
import ChannelMonitorService from "./src/services/channel_monitor_service.js";
import HealthReporter from "./src/services/health_reporter.js";
import { allProviders } from "./src/providers/index.js";

const INACTIVITY_CHECK_INTERVAL_MS = 1000 * 60 * 30;

try {
    await ProxyManager.init();
} catch (error) {
    Logger.error(`Nepodarilo se pripravit proxy: ${error.message}`);
    Logger.info('Pokracuji bez proxy');
}

const algorithmSettings = ConfigurationManager.getAlgorithmSetting;
const discordConfig = ConfigurationManager.getDiscordConfig;
const token = discordConfig.token;

Logger.info('Startuji bota');

// Kazdy poskytovatel si pripravi svoji relaci sam; Aukro zadnou nepotrebuje.
for (const provider of allProviders()) {
    try {
        await provider.init();
    } catch (error) {
        Logger.error(`Poskytovatel ${provider.name} se nepodarilo pripravit: ${error.message}`);
    }
}

// Hlaseni poruch chodi do log kanalu. Bez vyplneneho ID jdou jen do logu.
HealthReporter.configure({
    send: async (text) => {
        if (!discordConfig.log_channel_id) return;
        await postMessageToChannel(token, discordConfig.log_channel_id, text, [], []);
    },
});

const sendToChannel = async (item, vintedChannel, provider) => {
    const { embeds, components } = await provider.buildMessage(item, vintedChannel);

    const user = vintedChannel.user;
    const doMentionUser = user && vintedChannel.preferences.get(Preference.Mention);
    const mentionString = doMentionUser ? `<@${user.discordId}>` : '';

    try {
        await postMessageToChannel(token, vintedChannel.channelId, `${mentionString} `, embeds, components);
    } catch (error) {
        Logger.debug('Zpravu se nepodarilo poslat do kanalu');
        Logger.debug(error);
    }
};

Logger.info('Spoustim hlidani kanalu');

await ChannelMonitorService.start({
    getChannels: () => crud.getAllMonitoredVintedChannels(),
    intervalMs: algorithmSettings.monitor_interval_seconds * 1000,
    onItem: sendToChannel,
});

crud.eventEmitter.on('updated', async () => {
    await ChannelMonitorService.refresh();
    Logger.debug('Hlidane kanaly aktualizovany');
});

if (discordConfig.channel_inactivity_enabled) {
    setInterval(() => {
        checkVintedChannelInactivity(client)
    }, INACTIVITY_CHECK_INTERVAL_MS);
}
```

- [ ] **Step 3: Overit, ze se main.js da rozebrat**

```bash
node --check main.js && echo ok
```
Ocekavane: `ok`.

- [ ] **Step 4: Commit**

```bash
git add main.js src/utils/config_manager.js
git commit -m "feat: zapojit poskytovatele a hlaseni poruch"
```

---

### Task 13: Kontrola stavu, prikaz /test a skript

**Files:**
- Create: `src/services/status_check.js`
- Create: `src/bot/commands/test.js`
- Create: `scripts/check.mjs`
- Modify: `package.json` (skript `check` a `test`)
- Test: `test/status_check.test.js`

**Interfaces:**
- Consumes: `allProviders`, `resolveProvider`
- Produces: `runStatusCheck(url)` vraci pole `{ provider, ok, count, durationMs, error, kind, query }`

- [ ] **Step 1: Napsat padajici test**

```js
// test/status_check.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runStatusCheck } from '../src/services/status_check.js';

test('bez URL zkontroluje vsechny weby', async () => {
    const results = await runStatusCheck();
    assert.ok(results.length >= 2);
    const aukro = results.find(entry => entry.provider === 'aukro');
    assert.ok(aukro, 'chybi vysledek pro aukro');
    assert.equal(typeof aukro.durationMs, 'number');
});

test('se zadanou URL ukaze prelozeny dotaz', async () => {
    const [result] = await runStatusCheck('https://aukro.cz/panske-mikiny?text=nike&priceTo=100');
    assert.equal(result.provider, 'aukro');
    assert.deepEqual(result.query.dropped, ['priceTo']);
});

test('neznama URL vraci chybu', async () => {
    const [result] = await runStatusCheck('https://example.com/neco');
    assert.equal(result.ok, false);
    assert.match(result.error, /nezna/i);
});
```

- [ ] **Step 2: Spustit test a overit, ze pada**

Run: `node --test test/status_check.test.js`
Ocekavane: FAIL, modul neexistuje.

- [ ] **Step 3: Implementovat kontrolu**

```js
// src/services/status_check.js
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

// Bez URL zkontroluje vsechny weby ukazkovym dotazem, s URL jen ten jeden a
// ukaze i to, jak se URL prelozila na dotaz.
export async function runStatusCheck(url) {
    if (!url) {
        return Promise.all(allProviders().map(provider => checkProvider(provider, null)));
    }

    const provider = resolveProvider(url);
    if (!provider) {
        return [{ provider: 'neznamy', ok: false, count: 0, durationMs: 0, error: 'Tuhle adresu nezna zadny poskytovatel' }];
    }

    const query = provider.buildQuery(url);
    if (!provider.hasAnyFilter(query)) {
        return [{ provider: provider.name, ok: false, count: 0, durationMs: 0, error: 'URL neobsahuje zadny pouzitelny filtr', query }];
    }

    return [await checkProvider(provider, query)];
}
```

- [ ] **Step 4: Spustit test**

Run: `node --test test/status_check.test.js`
Ocekavane: PASS, 3 testy.

- [ ] **Step 5: Pridat prikaz /test**

```js
// src/bot/commands/test.js
import { SlashCommandBuilder } from 'discord.js';
import { createBaseEmbed } from '../components/base_embeds.js';
import { runStatusCheck } from '../../services/status_check.js';

export const data = new SlashCommandBuilder()
    .setName('test')
    .setDescription('Overi, jestli hlidane weby odpovidaji')
    .addStringOption(option =>
        option.setName('url')
            .setDescription('Nepovinna URL kanalu, ktera se ma otestovat')
            .setRequired(false));

function describe(result) {
    if (result.ok) {
        return `funguje, ${result.count} inzeratu za ${result.durationMs} ms`;
    }
    return `nefunguje: ${result.error} (${result.kind})`;
}

export async function execute(interaction) {
    await interaction.deferReply();

    const url = interaction.options.getString('url');
    const results = await runStatusCheck(url);

    const lines = results.map(result => {
        const dropped = result.query?.dropped?.length ? `\nzahozene parametry: ${result.query.dropped.join(', ')}` : '';
        return `**${result.provider}**: ${describe(result)}${dropped}`;
    });

    const embed = await createBaseEmbed(interaction, 'Stav hlidanych webu', lines.join('\n'), 0x00FF00);
    await interaction.editReply({ embeds: [embed] });
}
```

- [ ] **Step 6: Pridat skript pro terminal**

```js
// scripts/check.mjs
import { runStatusCheck } from '../src/services/status_check.js';

const url = process.argv[2];
const results = await runStatusCheck(url);

for (const result of results) {
    const stav = result.ok
        ? `OK   ${result.count} inzeratu za ${result.durationMs} ms`
        : `CHYBA ${result.error} (${result.kind})`;
    console.log(`${result.provider.padEnd(8)} ${stav}`);
    if (result.query?.dropped?.length) {
        console.log(`         zahozene parametry: ${result.query.dropped.join(', ')}`);
    }
}

process.exit(results.every(result => result.ok) ? 0 : 1);
```

- [ ] **Step 7: Doplnit skripty do package.json**

```json
    "test": "node --test test/",
    "check": "node scripts/check.mjs",
```

- [ ] **Step 8: Spustit vse**

```bash
npm test
npm run check
```
Ocekavane: testy prochazi; `npm run check` ukaze `aukro OK ...` a u Vintedu chybu tridy `gone`.

- [ ] **Step 9: Commit**

```bash
git add src/services/status_check.js src/bot/commands/test.js scripts/check.mjs package.json test/status_check.test.js
git commit -m "feat: kontrola stavu pres prikaz /test a skript"
```

---

### Task 14: Nasazeni na Pi a rucni overeni

**Files:**
- Modify: `.env` na Pi

**Interfaces:**
- Consumes: hotovou vetev z predchozich tasku

- [ ] **Step 1: Poslat vetev na GitHub a stahnout na Pi**

```bash
git push origin feat/aukro
ssh beda@100.101.120.60 'cd ~/vinted-bot && git fetch https://github.com/Kazalax/vinted-discord-bot feat/aukro && git merge --ff-only FETCH_HEAD'
```

- [ ] **Step 2: Zalozit log kanal a doplnit ID do .env**

Na Pi pridat radek `DISCORD_LOG_CHANNEL_ID=<id kanalu>` a overit prava souboru:

```bash
ssh beda@100.101.120.60 'cd ~/vinted-bot && chmod 600 .env && grep -c DISCORD_LOG_CHANNEL_ID .env'
```

- [ ] **Step 3: Restartovat bota**

```bash
ssh beda@100.101.120.60 'cd ~/vinted-bot && docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --force-recreate app'
```

- [ ] **Step 4: Overit start a hlaseni**

```bash
ssh beda@100.101.120.60 'sleep 60; docker logs vinted_app --tail 40'
```
Ocekavane: `Startuji bota`, `Hlidam N kanalu`, u kanalu Vintedu hlaseni tridy `zrusena adresa` a zastaveni hlidani misto opakovanych chyb kazdou minutu.

- [ ] **Step 5: Rucne overit v Discordu**

- `/test` vypise stav obou webu
- `/start_monitoring` s URL z Aukra zalozi hlidani a do minuty prijde prvni inzerat
- v log kanalu je hlaseni o nefunkcnim Vintedu

- [ ] **Step 6: Commit pripadnych oprav**

```bash
git add -A && git commit -m "fix: opravy po nasazeni na Pi"
```
