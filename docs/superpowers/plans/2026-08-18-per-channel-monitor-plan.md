# Monitorovaci engine na dotazy per kanal - implementacni plan

**Cil:** Bot posila do kazdeho monitorovaneho kanalu nove inzeraty odpovidajici hledani ulozenemu u toho kanalu.

**Architektura:** Kazdy kanal ma vlastni casovac. V intervalu se zepta Vinted na `/api/v2/catalog/items` s filtry prelozenymi z URL kanalu, odfiltruje uz videna ID, k novym polozkam dotahne detail ze stranky inzeratu a posle embed.

**Stack:** Node 20 (ESM), axios, discord.js 14, mongoose 8, Docker na Raspberry Pi 4.

**Spec:** `docs/superpowers/specs/2026-08-18-per-channel-monitor-design.md`

## Globalni omezeni

- Projekt nema test runner. Overovani probiha docasnymi skripty `.check-*.mjs` v korenu projektu, spoustenymi pres `docker run --rm --network vinted-bot_vinted-network -v /home/beda/vinted-bot:/app -w /app node:20.18.1 node .check-*.mjs`. Skripty se po dokonceni ukolu mazou.
- Komentare v kodu cesky bez diakritiky, stejne jako v uz opravenych souborech.
- Zadne nove npm zavislosti.
- Kazdy ukol konci commitem.
- Interval a dalsi konstanty patri do `.env`, ne do kodu.

---

### Ukol 1: fetchCatalogItems prijme filtry

**Soubory:** upravit `src/api/fetchCatalogItems.js`

**Rozhrani:**
- Produkuje: `fetchCatalogItems({ cookie, filters = {}, per_page = 96, order = 'newest_first' })` -> `{ items: Array }`, kde `filters` je objekt typu `{ catalog_ids: [257], brand_ids: [53], price_to: '500' }`. Pole se skladaji carkou (`catalog_ids=1,2`), skalary primo. Prazdne hodnoty se vynechavaji.

**Kroky:**
- [ ] Slozit query z `filters` pres `URLSearchParams`, zachovat `per_page` a `order`.
- [ ] Overit skriptem `.check-catalog.mjs`: dotaz s `{ brand_ids: [14] }` vrati polozky, kde `brand_title` je adidas; dotaz s `{}` vrati polozky; dotaz s `{ price_to: 10, currency: 'CZK' }` vrati polozky.
- [ ] Commit.

---

### Ukol 2: preklad URL kanalu na parametry API

**Soubory:** upravit `src/services/url_service.js`

**Rozhrani:**
- Konzumuje: `parseVintedSearchParams(url)` (uz existuje).
- Produkuje: `buildApiFiltersFromUrl(url)` -> objekt filtru pro `fetchCatalogItems`. Mapovani: `catalog[]`->`catalog_ids`, `brand_ids[]`->`brand_ids`, `size_ids[]`->`size_ids`, `status_ids[]`->`status_ids`, `color_ids[]`->`color_ids`, `material_ids[]`->`material_ids`, `video_game_platform_ids[]`->`video_game_platform_ids`, `search_text`->`search_text`, `price_from`->`price_from`, `price_to`->`price_to`, `currency`->`currency`. Vraci `null` pro nevalidni URL.
- Produkuje: `hasAnyFilter(filters)` -> boolean, pouzije ho validace v ukolu 7.

**Kroky:**
- [ ] Doplnit `currency` do `paramsKeys` v `parseVintedSearchParams` (dnes tam chybi, pritom cenove filtry ho potrebuji).
- [ ] Napsat `buildApiFiltersFromUrl` a `hasAnyFilter`, exportovat.
- [ ] Overit skriptem `.check-url.mjs` na URL `https://www.vinted.cz/catalog?catalog[]=257&brand_ids[]=53&price_to=500&currency=CZK`: vysledek obsahuje vsechny ctyri klice; na URL bez parametru vrati prazdny objekt a `hasAnyFilter` false; na nesmyslnem retezci vrati `null`.
- [ ] Commit.

---

### Ukol 3: detail inzeratu ze stranky

**Soubory:** vytvorit `src/api/fetchItemDetail.js`

**Rozhrani:**
- Produkuje: `fetchItemDetail({ cookie, url })` -> `{ description, brandId, catalogId, feedbackReputation, feedbackCount }`. Pri jakemkoli selhani vraci `{}`, nikdy nevyhazuje.

**Kroky:**
- [ ] Stahnout stranku pres `RequestBuilder` s `Accept: text/html` a timeoutem 30 s.
- [ ] Vytahnout hodnoty z payloadu: hledat `\"description\":`, `\"brand_id\":`, `\"catalog_id\":`, `\"feedback_reputation\":`, `\"feedback_count\":`; escapovany payload odescapovat stejne jako v `fetchCatalogInitializers.js`.
- [ ] Overit skriptem `.check-detail.mjs`: pro cerstvy inzerat z katalogu vrati neprazdny `description` a ciselne `brandId`; pro neexistujici URL vrati `{}` bez vyjimky.
- [ ] Commit.

---

### Ukol 4: VintedItem na dnesni tvar odpovedi

**Soubory:** upravit `src/entities/vinted_item.js`

**Rozhrani:**
- Produkuje: `new VintedItem(rawItem)` mapuje `price.amount`->`priceNumeric`, `price.currency_code`->`currency`, `brand_title`->`brand`, `size_title`->`size`, `status`->`status`, `photo`/`photos`->`photos`. Zpetne kompatibilni: kdyz prijdou stara pole (`price_numeric`, `brand`), pouziji se.
- Produkuje: `item.mergeDetail(detail)` doplni `description`, `brandId`, `catalogId` a hodnoceni prodejce do `item.user`.

**Kroky:**
- [ ] Doplnit mapovani a `mergeDetail`.
- [ ] Overit skriptem `.check-item.mjs`: polozka z katalogu ma neprazdny `title`, `priceNumeric > 0`, `currency`, `brand`, `size`, aspon jednu fotku; po `mergeDetail` ma `description` a `getNumericStars() > 0`.
- [ ] Commit.

---

### Ukol 5: ChannelMonitorService

**Soubory:** vytvorit `src/services/channel_monitor_service.js`

**Rozhrani:**
- Produkuje: `ChannelMonitorService.start({ getChannels, getCookie, intervalMs, onItem })`, `stop()`, `refresh()`.
  - `getChannels()` -> pole kanalu z `crud`, `getCookie()` -> aktualni cookie, `onItem(item, channel)` posila notifikaci.
- Stav per kanal: `lastSeenId`, `intervalMs`, `timer`.

**Kroky:**
- [ ] Pro kazdy kanal casovac; prvni beh jen ulozi nejvyssi ID a nic neposila.
- [ ] Dalsi behy: polozky s `id > lastSeenId` seradit vzestupne, k nim dotahnout detail, projit `matchVintedItemToSearchParams` (zakazana slova) a predat do `onItem`.
- [ ] Chyby: zalogovat a pokracovat pristi interval; po HTTP 429 interval kanalu zdvojnasobit (strop 10 nasobku), po uspechu vratit na vychozi.
- [ ] `refresh()` sesynchronizuje casovace se seznamem kanalu (nove pridat, zrusene zastavit).
- [ ] Overit skriptem `.check-monitor.mjs`: sluzba spustena nad umelym kanalem s URL `?catalog[]=1904` po prvnim behu neposle nic a ma `lastSeenId > 0`; po druhem behu s podvrzenym nizsim `lastSeenId` posle aspon jednu polozku s vyplnenym popisem.
- [ ] Commit.

---

### Ukol 6: embed bez zeme prodejce

**Soubory:** upravit `src/bot/components/item_embed.js`

**Kroky:**
- [ ] Odstranit pole `Country` a funkci `getFlagEmoji`.
- [ ] Osetrit chybejici hodnoty: kdyz neni `description`, pouzit nazev; kdyz neni hodnoceni, pole vynechat.
- [ ] Overit skriptem `.check-embed.mjs`: `createVintedItemEmbed` nad realnou polozkou vrati embed s vyplnenym titulkem, cenou a obrazkem a nevyhodi vyjimku ani u polozky bez detailu.
- [ ] Commit.

---

### Ukol 7: validace URL v start_monitoring

**Soubory:** upravit `src/bot/commands/start_monitoring.js`

**Kroky:**
- [ ] Nahradit podminku na `brand_ids[]` kontrolou `hasAnyFilter(buildApiFiltersFromUrl(url))`.
- [ ] Prelozit chybovou hlasku: v `locales/*.json` upravit klic `must-have-brand-query-param` na text o nutnosti aspon jednoho filtru; klic ponechat, aby nezustaly nepouzite preklady.
- [ ] Overit skriptem `.check-validate.mjs`: URL jen s `catalog[]` projde, URL bez parametru neprojde, URL mimo `/catalog` neprojde.
- [ ] Commit.

---

### Ukol 8: zapojeni do main.js

**Soubory:** upravit `main.js`, `.env`, `docker-compose.override.yml`

**Kroky:**
- [ ] Odstranit `monitorChannels`, `allMonitoringChannelsBrandMap` a volani `CatalogService`.
- [ ] Spustit `ChannelMonitorService` s `getChannels` z `crud`, `getCookie` z uz existujici obnovy cookie a `onItem` volajicim `sendToChannel`.
- [ ] Na udalost `crud.eventEmitter.on('updated')` volat `refresh()`.
- [ ] Doplnit `MONITOR_INTERVAL_SECONDS=60` do `.env` a cist ji v `config_manager.js` jako `getAlgorithmSetting.monitor_interval_seconds` s vychozi hodnotou 60.
- [ ] Overit skriptem `.check-startup.mjs`: importuje `main.js` s podvrzenym Discord klientem a overi, ze sekvence dobehne az k hlasce o spustenem monitoringu.
- [ ] Commit.

---

### Ukol 9: uklid a end-to-end overeni

**Kroky:**
- [ ] Smazat vsechny `.check-*.mjs`.
- [ ] `git status` musi byt cisty krome ignorovanych souboru.
- [ ] Spustit kompletni sekvenci skriptem `.verify.mjs` (URL -> filtry -> dotaz -> dedup -> detail -> embed) a ulozit vystup do odpovedi uzivateli.
- [ ] Po dodani Discord tokenu spustit `docker compose -f docker-compose.yml -f docker-compose.override.yml up -d` a overit v logu prihlaseni bota a registraci prikazu.
