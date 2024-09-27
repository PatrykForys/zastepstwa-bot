import { Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, Events, REST, Routes } from 'discord.js';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const userClasses = {}; // { serverId: { userId: className } }
const userChannels = {}; // { serverId: { userId: channelId } }
let lastSentDate = {}; // { serverId: lastSentDate }
let clientId;

const classCategories = {
    1: ["1a LO-p", "1PL Tech-p", "1ME Tech-p", "1RZA Tech-p", "1a BS-p", "1b BS-p"],
    2: ["2a LO-p", "2b LO-p", "2AR Tech-p", "2ME Tech-p", "2SI Tech-p", "2TL Tech-p", "2TP Tech-p", "2TZ Tech-p", "2aBS BS-p", "2bBS BS-p", "2cBS BS-p"],
    3: ["3a LO-p", "3b LO-p", "3TP Tech-p", "3TZ Tech-p", "3TM Tech-p", "3EO Tech-p", "3PS Tech-p", "3TI Tech-p", "3TL Tech-p", "3AR Tech-p", "3aBS BS-p", "3bBS BS-p"],
    4: ["4a LO-p", "4TP Tech-p", "4TL Tech-p", "4TI Tech-p", "4PI Tech-p", "4AR Tech-p", "4ME Tech-p"],
    5: ["5TP Tech-p", "5TM Tech-p", "5TI Tech-p", "5RZ Tech-p", "5LA Tech-p"]
};

async function fetchSubstitutionData(day, mode) {
    try {
        const response = await fetch("https://zs2ostrzeszow.edupage.org/substitution/server/viewer.js?__func=getSubstViewerDayDataHtml", {
            method: "POST",
            body: JSON.stringify({
                __args: [null, { date: day.toISOString().slice(0, 10), mode }],
                __gsh: "00000000"
            })
        });

        const fetchedData = await response.json();
        const htmlData = fetchedData.r;
        const { document } = (new JSDOM(htmlData)).window;

        if (document.querySelector(".nosubst")) {
            console.log('Brak zastępstw na ten dzień.');
            return [];
        }

        let data = Array.from(document.querySelectorAll("[data-date] .section, [data-date] .print-nobreak")).map(element => ({
            className: element.querySelector(".header").textContent.trim(),
            rows: Array.from(element.querySelectorAll(".rows .row")).map(row => row.querySelector(".info").textContent.trim())
        }));

        return data;
    } catch (error) {
        console.error('Błąd podczas pobierania danych o zastępstwach:', error);
    }
}

const commands = [
    {
        name: 'klasa',
        description: 'Wybierz swoją klasę 1-5.',
        options: [
            {
                type: 4,
                name: 'numer_klasy',
                description: 'twoja klasa (1-5)',
                required: true,
            }
        ]
    },
    {
        name: 'sprawdz',
        description: 'Sprawdź zastępstwa dla swojej klasy.',
        options: [
            {
                type: 3,
                name: 'data',
                description: 'Wybierz datę: dzisiaj lub jutro',
                required: true,
                choices: [
                    { name: 'Dzisiaj', value: 'dzisiaj' },
                    { name: 'Jutro', value: 'jutro' }
                ]
            }
        ]
    }
];

const registerCommands = async () => {
    if (!clientId) {
        console.error('Client ID jest niezdefiniowany. Rejestracja komend przerwana.');
        return;
    }

    const rest = new REST({ version: '9' }).setToken(token);
    try {
        console.log('Rejestracja komend');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Komendy zostały zarejestrowane');
    } catch (error) {
        console.error('Nie udało się zarejestrować komend:', error);
    }
};

const checkSubstitutions = async () => {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const today = now.toISOString().slice(0, 10);

    if (dayOfWeek === 0 || dayOfWeek === 6) {
        console.log('Dziś jest sobota lub niedziela. Nie sprawdzamy zastępstw.');
        return;
    }

    if (hour >= 20 && hour < 23) {
        const day = new Date();
        const dayOfWeekTomorrow = (day.getDay() + 1) % 7;

        if (dayOfWeek === 5 && dayOfWeekTomorrow === 6) {
            // console.log('Jutro jest sobota. Nie sprawdzamy zastępstw.');
            return;
        }

        const substitutions = await fetchSubstitutionData(day, 'classes');

        client.guilds.cache.forEach(guild => {
            if (!lastSentDate[guild.id] || lastSentDate[guild.id] !== today) {
                for (const userId in userClasses[guild.id] || {}) {
                    const className = userClasses[guild.id][userId];
                    const channelId = userChannels[guild.id][userId];

                    if (!className || !channelId) continue;

                    const filteredData = substitutions.filter(entry => entry.className === className);

                    const channel = client.channels.cache.get(channelId);
                    if (filteredData.length > 0) {
                        let message = `Zastępstwa dla klasy **${className}** na dzisiaj:\n`;
                        filteredData.forEach(entry => {
                            message += `${entry.rows.join('\n')}\n\n`;
                        });

                        if (channel) {
                            channel.send(message);
                            lastSentDate[guild.id] = today; // Aktualizacja daty ostatniego wysłania wiadomości dla serwera
                        }
                    } else {
                        if (channel) {
                            channel.send(`Brak zastępstw dla klasy ${className} na dzisiaj.`);
                            lastSentDate[guild.id] = today; // Aktualizacja daty ostatniego wysłania wiadomości dla serwera
                        }
                    }
                }
            } else {
                console.log(`Zastępstwa dla serwera ${guild.id} już wysłane dzisiaj.`);
            }
        });
    } else {
        console.log('Zastępstwa sprawdzane tylko między godziną 20:00 a 23:00.');
    }
};

setInterval(checkSubstitutions, 1 * 1 * 1000); // Sprawdzanie co minutę

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options, guildId } = interaction;

    if (commandName === 'klasa') {
        const year = options.getInteger('numer_klasy');
        if (year < 1 || year > 5) {
            return interaction.reply('Podaj klase (1-5)');
        }

        const selectedClasses = classCategories[year];

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_class')
            .setPlaceholder(`Wybierz swoją klasę ${year}`)
            .addOptions(selectedClasses.map(className => ({
                label: className,
                value: className
            })));

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: `Wybierz swoją klasę z ${year} roku:`, components: [row] });

        if (!userChannels[guildId]) userChannels[guildId] = {};
        userChannels[guildId][interaction.user.id] = interaction.channel.id;
    } else if (commandName === 'sprawdz') {
        if (!userClasses[guildId]) userClasses[guildId] = {};
        const className = userClasses[guildId][interaction.user.id];

        if (!className) {
            return interaction.reply('Nie masz wybranej klasy. Użyj komendy /klasa aby ją ustawić.');
        }

        const dateOption = options.getString('data');
        const day = new Date();

        if (dateOption === 'jutro') {
            day.setDate(day.getDate() + 1);
        }

        const substitutions = await fetchSubstitutionData(day, 'classes');

        if (substitutions.length === 0) {
            return interaction.reply(`Brak zastępstw na ${day.toISOString().slice(0, 10)}.`);
        } else {
            const filteredData = substitutions.filter(entry => entry.className === className);
            if (filteredData.length === 0) {
                return interaction.reply(`Brak zastępstw dla klasy ${className} na ${day.toISOString().slice(0, 10)}.`);
            } else {
                let response = filteredData.map(entry => {
                    const classDetails = entry.rows.length ? entry.rows.join('\n') : 'Brak szczegółów.';
                    return `Zastępstwa dla klasy: ${entry.className}\n${classDetails}`;
                }).join('\n\n');

                await interaction.reply(response);
            }
        }
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isSelectMenu()) {
        if (interaction.customId === 'select_class') {
            await interaction.deferUpdate();

            const className = interaction.values[0];
            const guildId = interaction.guildId;

            if (!userClasses[guildId]) userClasses[guildId] = {};
            userClasses[guildId][interaction.user.id] = className;

            await interaction.followUp({ content: `Zapamiętano klasę ${className} dla użytkownika ${interaction.user.username}.`, ephemeral: true });
        }
    }
});

client.once('ready', async () => {
    console.log('Bot jest online!');
    clientId = client.user.id;
    console.log(`Client ID: ${clientId}`);
    await registerCommands();
});

client.login();