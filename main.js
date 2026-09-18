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
        Logger.info(`Poskytovatel ${provider.name} pripraven`);
    } catch (error) {
        Logger.error(`Poskytovatele ${provider.name} se nepodarilo pripravit: ${error.message}`);
    }
}

// Hlaseni poruch chodi do log kanalu. Bez vyplneneho ID jdou jen do logu.
if (!discordConfig.log_channel_id) {
    Logger.warn('DISCORD_LOG_CHANNEL_ID neni vyplnene, hlaseni poruch pujdou jen do logu');
}

HealthReporter.configure({
    send: async (text) => {
        if (!discordConfig.log_channel_id) {
            return;
        }
        await postMessageToChannel(token, discordConfig.log_channel_id, text, [], []);
    },
});

const sendToChannel = async (item, vintedChannel, provider) => {
    const { embeds, components } = await provider.buildMessage(item, vintedChannel);

    const user = vintedChannel.user;
    const doMentionUser = user && vintedChannel.preferences.get(Preference.Mention);
    const mentionString = doMentionUser ? `<@${user.discordId}>` : '';

    try {
        await postMessageToChannel(
            token,
            vintedChannel.channelId,
            `${mentionString} `,
            embeds,
            components
        );
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
