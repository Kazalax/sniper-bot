# Monitorovaci engine na dotazy per kanal

Datum: 2026-08-18

## Problem

Bot sledoval Vinted tak, ze v nekonecne smycce inkrementoval ID inzeratu a kazde
ID stahoval pres `GET /api/v2/items/{id}`. Ten endpoint dnes vraci 404 pro vsechna
ID (overeno na cerstvych ID primo z katalogu, se vsemi variantami hlavicek), takze
callback `handleItem` v `main.js` se nikdy nezavola a bot neposle zadnou notifikaci.

Nahradit zdroj dat jednim volanim `GET /api/v2/catalog/items` nestaci: dnesni
odpoved katalogu je zkracena a neobsahuje `brand_id`, `catalog_id`, `description`
ani `user.country_code`. Prave podle `brand_id` pritom `main.js` paruje inzeraty na
kanaly (`crud.js:325` plni mapu z `brand_ids` kanalu), takze by parovani nikdy
neuspelo. Dohledat `brand_id` podle nazvu znacky nejde, `/api/v2/brands/search`
vraci vzdy `{"brand":null}`.

## Cil

Bot posila do kazdeho monitorovaneho kanalu nove inzeraty, ktere odpovidaji
hledani ulozenemu u toho kanalu, bez zavislosti na poli, ktera Vinted uz
neposkytuje.

## Overena fakta o dnesnim API

| Zjisteni | Dopad na navrh |
|---|---|
| `GET /api/v2/items/{id}` vraci 404 | puvodni engine je nepouzitelny |
| `GET /api/v2/catalog/items` funguje a prijima `catalog_ids`, `brand_ids`, `size_ids`, `status_ids`, `color_ids`, `material_ids`, `price_from`, `price_to`, `search_text`, `order` | filtrovani prenechame serveru |
| odpoved katalogu nese jen `id, title, url, price, brand_title, size_title, status, photos, user{id, login, profile_url, photo}` | detail se musi dotahnout zvlast |
| stranka inzeratu obsahuje v serverovem payloadu `description`, `brand_id`, `catalog_id`, `feedback_reputation`, `feedback_count` | zdroj detailu |
| zemi prodejce neposila katalog ani stranka inzeratu | filtr zemi prestava fungovat |

## Architektura

Novy `ChannelMonitorService` nahrazuje `CatalogService`. Kazdy monitorovany kanal
ma vlastni planovac; kanaly na sobe nezavisi.

```
kanal (Vinted URL)
  -> preklad URL parametru na parametry API
  -> GET /api/v2/catalog/items?...&order=newest_first        [1 dotaz / kanal / interval]
  -> zahodit polozky s ID <= posledni videne ID kanalu
  -> pro kazdou novou: GET stranky inzeratu -> doplnit detail  [1 dotaz / nova polozka]
  -> zakazana slova (nazev + popis)
  -> Discord embed do kanalu
```

### Komponenty

**`src/services/channel_monitor_service.js`** (novy)
Drzi za kazdy kanal posledni videne ID a casovac. Rozhrani: `start(channels, cookie,
callback)`, `stop()`, `refresh(channels)` pri zmene seznamu kanalu. Nezna Discord ani
Mongo, dostava kanaly a vraci polozky pres callback.

**`src/api/fetchItemDetail.js`** (novy)
Stahne stranku inzeratu a vytahne detail ze serveroveho payloadu. Stejny princip jako
uz opraveny `fetchCatalogInitializers.js`, tedy hledani klice a cteni vyvazenych
zavorek. Pri neuspechu vraci prazdny objekt, ne vyjimku, aby chybejici detail
neshodil notifikaci.

**`src/api/fetchCatalogItems.js`** (uprava)
Prijme objekt filtru a slozi z nej query parametry. Zachova `per_page` a `order`.

**`src/services/url_service.js`** (uprava)
Doplnit preklad rozparsovane URL kanalu na parametry API. Lokalni filtrovani podle
kategorie a znacky odpada (dela ho server), zakazana slova a fuzzy hledani zustavaji.

**`src/entities/vinted_item.js`** (uprava)
Mapovani na dnesni tvar odpovedi: `price.amount` misto `price_numeric`,
`brand_title` misto `brand`, `size_title` misto `size`. Metoda pro slouceni s
detailem ze stranky inzeratu.

**`src/bot/components/item_embed.js`** (uprava)
Vypustit pole se zemi prodejce. Ostatni pole zustavaji, doplnena z detailu.

**`src/bot/commands/start_monitoring.js`** (uprava)
Zrusit podminku, ze URL musi obsahovat `brand_ids[]`. Nova podminka: aspon jeden
podporovany filtr, aby kanal nesledoval cely Vinted.

**`main.js`** (uprava)
Odstranit parovani pres `allMonitoringChannelsBrandMap` a spustit novy service.
Zachovat obnovu cookie a reakci na udalost `updated` z `crud`.

**`.env`** doplnit `MONITOR_INTERVAL_SECONDS=60`.

## Chovani

**Deduplikace.** Za kazdy kanal se drzi nejvyssi videne ID inzeratu, v pameti.
Prvni davka po startu se pouze zapamatuje a neposila, jinak by po kazdem restartu
prisla salva starych inzeratu. Po restartu se nedozeni polozky z doby vypadku, coz
je vedomy kompromis proti ukladani stavu do Mongo.

**Chyby.** Selhany dotaz na kanal se zaloguje a opakuje v dalsim intervalu; jeden
rozbity kanal nesmi zastavit ostatni. Po HTTP 429 se interval daneho kanalu
zdvojnasobi az do prvniho uspesneho dotazu, pak se vrati na puvodni hodnotu.

**Zatez.** Pri deseti kanalech a intervalu 60 s jde o deset dotazu za minutu plus
detail ke kazde nove polozce. Radove mene nez puvodni smycka, ktera stahovala
tisice ID za minutu.

## Co po zmene prestane fungovat

- Filtr zeme prodejce a `BLACKLISTED_COUNTRIES_CODES`; zemi Vinted neposila.
- `ALGORITHM_FILTER_ZERO_STARS_PROFILES` funguje az po dotazeni detailu, tedy az
  po serverovem filtrovani, ne pred nim.

## Overeni

Projekt nema testy a nebudou se zakladat. Overi se skriptem, ktery projde cely
retezec bez Discordu: URL kanalu -> parametry API -> dotaz -> deduplikace ->
detail -> sestaveny embed. Nasledne realnym behem s Discord tokenem.
