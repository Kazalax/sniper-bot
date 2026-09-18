import { SlashCommandBuilder } from 'discord.js';
import { createBaseEmbed, sendErrorEmbed, sendWaitingEmbed, sendWarningEmbed } from '../components/base_embeds.js';
import crud from '../../crud.js';
import t from '../../t.js';
import { validateMonitoringUrl, urlNeedsSearchTextWarning } from '../../services/url_validation.js';

export const data = new SlashCommandBuilder()
    .setName('start_monitoring')
    .setDescription('Start monitoring this channel (Vinted or Aukro).')
    .addStringOption(option =>
        option.setName('url')
            .setDescription('The URL of the search page on Vinted or Aukro.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('banned_keywords')
            .setDescription('Keywords to ban from the search results. (separate with commas -> "keyword1, keyword2")')
            .setRequired(false));

export async function execute(interaction) {
    const l = interaction.locale;
    await sendWaitingEmbed(interaction, t(l, 'starting-monitoring'));

    const url = interaction.options.getString('url');
    const bannedKeywords = interaction.options.getString('banned_keywords') ? interaction.options.getString('banned_keywords').split(',').map(keyword => keyword.trim()) : [];
    const discordId = interaction.user.id;
    const channelId = interaction.channel.id;

    // validate the URL
    const validation = validateMonitoringUrl(url);
    if (validation !== true) {
        await sendErrorEmbed(interaction, t(l, validation));
        return;
    }

    try {
        // Get the user
        const user = await crud.getUserByDiscordId(discordId);
        if (!user) {
            await sendErrorEmbed(interaction, t(l, 'user-not-found'));
            return;
        }

        // Find the VintedChannel by channelId and ensure it's owned by the user
        const vintedChannel = user.channels.find(channel => channel.channelId === channelId && channel.user.equals(user._id));
        if (!vintedChannel) {
            await sendErrorEmbed(interaction, t(l, 'channel-not-found-nor-owned'));
            return;
        }

        // Check if URL is provided or present in the VintedChannel
        if (!url && !vintedChannel.url) {
            await sendErrorEmbed(interaction, t(l, 'provide-vaild-url') + " " + t(l, url));
            return;
        }

        // Check if the URL contains the search_text parameter
        if (urlNeedsSearchTextWarning(url)) {
            await sendWarningEmbed(interaction, t(l, 'url-contains-search-text'));
        }

        const embed = await createBaseEmbed(
            interaction,
            t(l, 'monitoring-started'),
            t(l, 'monitoring-has-been-started', { url: url || vintedChannel.url}),
            0x00FF00
        );

        await interaction.followUp({ embeds: [embed] });

        await crud.setVintedChannelUpdatedAtNow(channelId);
        await crud.setVintedChannelBannedKeywords(channelId, bannedKeywords);

        // Update the VintedChannel with the provided URL (if any) and set isMonitoring to true
        await crud.startVintedChannelMonitoring(vintedChannel._id, url);
    } catch (error) {
        console.error('Error starting monitoring session:', error);
        await sendErrorEmbed(interaction, 'There was an error starting the monitoring session.');
    }
}
