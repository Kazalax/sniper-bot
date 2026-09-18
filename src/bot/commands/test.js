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
        const dropped = result.query?.dropped?.length
            ? `\nzahozene parametry URL: ${result.query.dropped.join(', ')}`
            : '';
        return `**${result.provider}**: ${describe(result)}${dropped}`;
    });

    const allOk = results.every(result => result.ok);
    const embed = await createBaseEmbed(interaction, 'Stav hlidanych webu', lines.join('\n'), allOk ? 0x00FF00 : 0xFF0000);

    await interaction.editReply({ embeds: [embed] });
}
