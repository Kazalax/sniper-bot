import { ActionRowBuilder } from 'discord.js';
import { createBaseEmbed, createBaseUrlButton } from '../../bot/components/base_embeds.js';
import { attribute } from './item.js';

const EMBED_COLOR = '#0f7c3f';

function price(value) {
    return value && value.amount ? `${value.amount} ${value.currency}` : '';
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
    embed.setFields(fields.filter(field => field.value && String(field.value).trim().length > 0));

    if (raw.titleImageUrl) {
        embed.setImage(raw.titleImageUrl);
    }

    const actionRow = new ActionRowBuilder();
    actionRow.addComponents(await createBaseUrlButton('Zobrazit na Aukru', item.url));

    return { embeds: [embed], components: [actionRow] };
}
