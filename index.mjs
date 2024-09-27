import { Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, Events, REST, Routes } from 'discord.js';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import dotenv from 'dotenv';
dotenv.config();


const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });


const userClasses = {};
const userChannels = {};
const token = "TOKEN_BOTA"; 
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
        description: 'Wybierz swoją klasę z lat 1-5.',
        options: [
            {
                type: 4,
                name: 'numer_klasy',
                description: 'Numer twojej klasy (1-5)',
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
        console.log('Rozpoczynam rejestrację globalnych komend...');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Komendy globalne zostały zarejestrowane!');
    } catch (error) {
        console.error('Nie udało się zarejestrować komend:', error);
    }
};


const checkSubstitutions = async () => {
    const now = new Date();
    const hour = now.getHours();

    if (hour >= 20) {
        const day = new Date();
        const substitutions = await fetchSubstitutionData(day, 'classes');

        for (const userId in userClasses) {
            const className = userClasses[userId];
            const channelId = userChannels[userId];

            if (!className || !channelId) continue;

            const filteredData = substitutions.filter(entry => entry.className === className);

            if (filteredData.length > 0) {
                let message = `Zastępstwa dla klasy **${className}** na dzisiaj:\n`;
                filteredData.forEach(entry => {
                    message += `${entry.rows.join('\n')}\n\n`;
                });

                const channel = client.channels.cache.get(channelId);
                if (channel) {
                    channel.send(message);
                }
            } else {
                console.log(`Brak zastępstw dla klasy ${className} na dzisiaj.`);
            }
        }
    } else {
        console.log('Zastępstwa sprawdzane tylko po godzinie 20:00.');
    }
};


setInterval(checkSubstitutions, 15 * 60 * 1000);


client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'klasa') {
        const year = options.getInteger('numer_klasy');
        if (year < 1 || year > 5) {
            return interaction.reply('Podaj numer klasy (1-5), aby uzyskać listę klas.');
        }

        const selectedClasses = classCategories[year];

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_class')
            .setPlaceholder(`Wybierz swoją klasę z ${year} roku`)
            .addOptions(selectedClasses.map(className => ({
                label: className,
                value: className
            })));

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: `Wybierz swoją klasę z ${year} roku:`, components: [row] });

        userChannels[interaction.user.id] = interaction.channel.id;
    } else if (commandName === 'sprawdz') {
        const className = userClasses[interaction.user.id];

        if (!className) {
            return interaction.reply('Nie masz zapamiętanej klasy. Użyj komendy /klasa, aby ją ustawić.');
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
                    return `Szczegóły dla klasy: ${entry.className}\n${classDetails}`;
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
            userClasses[interaction.user.id] = className;

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


client.login(token);