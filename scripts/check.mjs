import { runStatusCheck } from '../src/services/status_check.js';

// Stejna kontrola jako prikaz /test, jen pro terminal na Pi.
const url = process.argv[2];
const results = await runStatusCheck(url);

for (const result of results) {
    const stav = result.ok
        ? `OK    ${result.count} inzeratu za ${result.durationMs} ms`
        : `CHYBA ${result.error} (${result.kind})`;
    console.log(`${result.provider.padEnd(8)} ${stav}`);

    if (result.query?.dropped?.length) {
        console.log(`${''.padEnd(8)} zahozene parametry URL: ${result.query.dropped.join(', ')}`);
    }
}

process.exit(results.every(result => result.ok) ? 0 : 1);
