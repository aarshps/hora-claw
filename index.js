const { Telegraf } = require('telegraf');
const { exec } = require('child_process');
const fs = require('fs');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const CHATS_FILE = 'chats.json';

function saveChatId(chatId) {
    let chats = new Set();
    if (fs.existsSync(CHATS_FILE)) {
        try {
            chats = new Set(JSON.parse(fs.readFileSync(CHATS_FILE)));
        } catch (e) {
            console.error("Failed to read chats.json", e);
        }
    }
    if (!chats.has(chatId)) {
        chats.add(chatId);
        fs.writeFileSync(CHATS_FILE, JSON.stringify(Array.from(chats)));
    }
}

async function broadcastStatus(message) {
    if (fs.existsSync(CHATS_FILE)) {
        try {
            const chats = JSON.parse(fs.readFileSync(CHATS_FILE));
            for (const chatId of chats) {
                await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(err => {
                    console.error(`Failed to send to ${chatId}:`, err);
                });
            }
        } catch (e) {
            console.error("Failed to broadcast", e);
        }
    }
}

const GEMINI_PATH = `"C:\\Users\\Aarsh\\AppData\\Roaming\\npm\\gemini.cmd"`;

function runGemini(prompt, useResume = true) {
    return new Promise((resolve, reject) => {
        // Inject persona context
        const personaPrefix = "[System Context: You are a human-like claw named Hora-claw, serving the user via Telegram. You can do stuff. Never use the word 'agent', or refer to yourself as Gemini, a project, or a CLI. You are the claw itself.]\\n\\n";
        const fullPrompt = personaPrefix + prompt;
        // Escape quotes for Windows shell
        const escapedPrompt = fullPrompt.replace(/"/g, '""');
        let command = `${GEMINI_PATH} -p "${escapedPrompt}" --yolo`;
        if (useResume) {
            command += ' --resume latest';
        }

        console.log(`Executing: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.log(`Gemini process finished with error code ${error.code}`);
                // If it's the first time and there's no "latest" session, try without resume
                if (useResume && (stderr.toLowerCase().includes('failed to resume') || stderr.toLowerCase().includes('not found'))) {
                    console.log('Falling back to new session (no resume found)');
                    return runGemini(prompt, false).then(resolve).catch(reject);
                }
                console.error(`Gemini Error: ${stderr}`);
                if (stdout.trim()) {
                    return resolve(stdout);
                }
                return reject(new Error(stderr || error.message));
            }
            resolve(stdout);
        });
    });
}

bot.start((ctx) => {
    saveChatId(ctx.chat.id);
    ctx.reply('Welcome! I am Hora-claw. How can I help you today?');
});

bot.command('reset', async (ctx) => {
    ctx.reply('Resetting my memory and starting a fresh session... 🧹');

    exec(`"${GEMINI_PATH.replace(/"/g, '')}" --delete-session latest`, (error, stdout, stderr) => {
        if (error || stderr) {
            console.error('Error deleting session:', error || stderr);
            ctx.reply('Experienced an issue clearing memory, but starting fresh anyway!');
        } else {
            ctx.reply('Memory cleared! I am ready for a new task as Hora-claw.');
        }
    });
});

bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text;
    console.log(`Received message: ${userMessage}`);
    saveChatId(ctx.chat.id);

    let typingInterval = setInterval(() => {
        ctx.sendChatAction('typing').catch(() => { });
    }, 4000);

    try {
        await ctx.sendChatAction('typing');
        let output = await runGemini(userMessage);
        clearInterval(typingInterval);

        output = output.replace(/Loaded cached credentials\.?/gi, '').trim();

        if (!output) {
            output = "I'm sorry, I couldn't generate a response.";
        }

        // Parse Markdown to HTML for Telegram
        const striptags = require('striptags');
        const { marked } = require('marked');
        let htmlOutput = marked.parse(output, { breaks: true });

        // replace paragraph and br tags with newlines to preserve spacing
        htmlOutput = htmlOutput.replace(/<\/p>/g, '\n');
        htmlOutput = htmlOutput.replace(/<br\s*\/?>/g, '\n');

        // telegram uses a subset of HTML: b, strong, i, em, u, ins, s, strike, del, a, code, pre
        const allowedTags = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre'];
        htmlOutput = striptags(htmlOutput, allowedTags).trim();

        if (htmlOutput.length > 4000) {
            for (let i = 0; i < htmlOutput.length; i += 4000) {
                await ctx.replyWithHTML(htmlOutput.substring(i, i + 4000)).catch(err => {
                    console.error('Telegram replyWithHTML error:', err);
                    ctx.reply(output.substring(i, i + 4000)); // Fallback
                });
            }
        } else {
            await ctx.replyWithHTML(htmlOutput).catch(err => {
                console.error('Telegram replyWithHTML error:', err);
                ctx.reply(output); // Fallback
            });
        }

    } catch (error) {
        clearInterval(typingInterval);
        console.error('Gemini Execution Error:', error);
        ctx.reply('An error occurred. Gemini said: ' + error.message.substring(0, 150));
    }
});

bot.launch().then(async () => {
    console.log('hora-claw is running on Telegram!');
    await broadcastStatus('🟢 *Hora-claw is online!* I am ready to assist you.');
}).catch(err => {
    console.error('Failed to launch bot:', err);
});

const gracefulShutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    await broadcastStatus('🔴 *Hora-claw is going offline!* I will be back shortly.');
    bot.stop(signal);
    process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
