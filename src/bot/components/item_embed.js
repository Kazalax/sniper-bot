import { EmbedBuilder, ActionRowBuilder } from "discord.js";
import { createBaseActionButton, createBaseEmbed, createBaseUrlButton } from "./base_embeds.js";
import Logger from "../../utils/logger.js";

function getNumberOfStars(rating) {
    rating = rating * 5;
    rating = Math.round(rating);

    const stars = '⭐️'.repeat(rating);
    return stars;
}

function replaceDomainInUrl(url, domain) {
    return url.replace(/vinted\.(.*?)\//, `vinted.${domain}/`);
}

export async function createVintedItemEmbed(item, domain = "fr") {
    // Popis se dotahuje ze stranky inzeratu a nemusi dorazit, embed pak zustane bez nej.
    const hasDescription = item.description && item.description !== 'N/A';

    const embed = await createBaseEmbed(
        null,
        item.title,
        hasDescription ? `📝 ${item.description}` : ' ',
        item.getDominantColor()
    )

    embed.setURL(replaceDomainInUrl(item.url, domain));

    const fields = [
        { name: '💰 Price', value: `${item.priceNumeric} ${item.currency}`, inline : true},
        { name: '📏 Size', value: `${item.size} ` , inline : true },
        { name: '🏷️ Brand', value: `${item.brand} ` , inline : true },
        { name: '📦 Condition', value: `${item.status} `, inline : true },
    ];

    // Cas upravy inzeratu chodi jen v detailu; bez nej by pole ukazovalo rok 1970.
    if (item.unixUpdatedAt > 0) {
        fields.push({ name: '📅 Updated', value: `${item.unixUpdatedAtString} `, inline : true});
    }

    // Hodnoceni prodejce pochazi z detailu inzeratu, bez nej se pole vynecha.
    const rating = item.user ? item.user.feedback_reputation : 0;
    if (rating > 0) {
        const ratingStars = getNumberOfStars(rating);
        const ratingTextRounded = Math.round(rating * 50) / 10;
        fields.push({ name: '⭐️ User Rating', value: `${ratingStars} (${ratingTextRounded}) of ${item.user.feedback_count}`, inline : true});
    }

    // Discord odmitne pole s prazdnou hodnotou a katalog nektera pole (velikost,
    // znacka) u casti inzeratu vubec nevraci.
    embed.setFields(fields.filter(field => {
        const value = field.value.trim();
        return value && value !== 'N/A';
    }));

    const photosEmbeds = []
    const maxPhotos = 3;

    // Add first photo
    const firstPhoto = item.photos[0];
    if (firstPhoto) {
        if (firstPhoto.fullSizeUrl) {
            embed.setImage(`${firstPhoto.fullSizeUrl}`);
        } else {
            Logger.error(`No fullSizeUrl for photo: ${firstPhoto}`);
            return { embed, photosEmbeds };
        }
    } else {
        Logger.error(`No photo for item: ${item}`);
        return { embed, photosEmbeds };
    }

    // Add photos
    for (let i = 1; i < item.photos.length && i < maxPhotos; i++) {
        const photo = item.photos[i];

        const photoEmbed = new EmbedBuilder()
            .setImage(`${photo.fullSizeUrl}`)
            .setURL(replaceDomainInUrl(item.url, domain));

        photosEmbeds.push(photoEmbed);
    }

    return { embed, photosEmbeds };
}

export async function createVintedItemActionRow(item, domain) {
    const actionRow = new ActionRowBuilder();

    const sendMessageUrl = `https://www.vinted.${domain}/items/${item.id}/want_it/new?button_name=receiver_id=${item.id}`;
    const buyUrl = `https://www.vinted.${domain}/transaction/buy/new?source_screen=item&transaction%5Bitem_id%5D=${item.id}`;

    actionRow.addComponents(
        await createBaseUrlButton("🔗 View on Vinted", replaceDomainInUrl(item.url, domain)),
        await createBaseUrlButton("📨 Send Message", sendMessageUrl),
        await createBaseUrlButton("💸 Buy", buyUrl)
    );

    return actionRow;
}
