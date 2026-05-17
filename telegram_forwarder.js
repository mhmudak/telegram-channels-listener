import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { Api } from "telegram";
import input from "input";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;

const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;

if (!process.env.API_ID || !process.env.API_HASH || !process.env.BOT_TOKEN) {
    throw new Error("Missing environment variables");
}

/* CHANNELS */
const channels = {
    "-1003873074287": "ABR",
    "-1002206629263": "Golden Bullet",
    "-1002017948189": "The Golden Astro",
    "-1002248922519": "Carl",
    "-1003423393382": "MyChannel TEST"
};

/* DUPLICATE CACHE */
const processedMessages = new Set();

const sessionFile = "session.txt";

let stringSession = "";
if (fs.existsSync(sessionFile)) {
    stringSession = fs.readFileSync(sessionFile, "utf8");
}

const session = new StringSession(stringSession);

const client = new TelegramClient(
    session,
    apiId,
    apiHash,
    {
        connectionRetries: 5,
        autoReconnect: true,
        useWSS: false,
        timeout: 30000
    }
);

const mediaGroups = new Map();

let downloading = false;

async function sendTelegramFile(method, field, buffer, filename, caption = "") {

    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) {
        form.append("caption", caption);
    }
    form.append(field, new Blob([buffer]), filename);

    await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: "POST",
        body: form
    });
}

async function startClient() {

    await client.start({
        phoneNumber: async () => await input.text("Telegram phone: "),
        password: async () => await input.text("2FA password (if any): "),
        phoneCode: async () => await input.text("Code from Telegram: "),
        onError: (err) => console.log(err),
    });

    console.log("✅ Telegram connected");

    const savedSession = client.session.save();
    fs.writeFileSync(sessionFile, savedSession);

    client.addEventHandler(async (event) => {

        const sourceChatId = String(event.chatId);
        if (!(sourceChatId in channels)) return;

        console.log("Incoming chat:", sourceChatId, "→", channels[sourceChatId]);

        const message = event.message;
        if (!message) return;

        /* DUPLICATE PROTECTION */
        if (processedMessages.has(message.id)) return;
        processedMessages.add(message.id);

        if (processedMessages.size > 5000) processedMessages.clear();

        const channelName = channels[sourceChatId];
        const now = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Beirut",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        }).format(new Date());
        const caption = message.message || message.text || "";
        try {

            /* TEXT */
            if (message.text) {

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `📢📢📢📢📢\n${message.text}\n\n🔔 ${channelName}\n${now}\n`
                    })
                });

            }

            /* PHOTO */
            if (message.photo) {

                while (downloading) {
                    await new Promise(r => setTimeout(r, 200));
                }

                downloading = true;

                const buffer = await client.downloadMedia(message, {
                    workers: 1
                });

                downloading = false;

                await sendTelegramFile(
                    "sendPhoto",
                    "photo",
                    buffer,
                    "photo.jpg",
                    caption
                );

                return;
            }

            /* MEDIA */
            if (message.media) {

                while (downloading) {
                    await new Promise(r => setTimeout(r, 200));
                }

                downloading = true;

                const buffer = await client.downloadMedia(message, {
                    workers: 1
                });

                downloading = false;

                const doc = message.media.document;

                if (doc) {
                    /* GIF / ANIMATION */
                    if (doc.mimeType === "image/gif") {

                        await sendTelegramFile(
                            "sendAnimation",
                            "animation",
                            buffer,
                            "animation.gif",
                            caption
                        );

                        return;
                    }

                    const animated = doc.attributes?.find(
                        a => a instanceof Api.DocumentAttributeAnimated
                    );

                    if (animated) {

                        await sendTelegramFile(
                            "sendAnimation",
                            "animation",
                            buffer,
                            "animation.mp4",
                            caption
                        );

                        return;
                    }

                    const stickerAttr = doc.attributes?.find(
                        a => a instanceof Api.DocumentAttributeSticker
                    );

                    if (stickerAttr) {

                        const mime = doc.mimeType || "image/webp";

                        let filename = "sticker.webp";

                        if (mime.includes("tgsticker")) filename = "sticker.tgs";
                        if (mime.includes("webm")) filename = "sticker.webm";

                        await sendTelegramFile(
                            "sendSticker",
                            "sticker",
                            buffer,
                            filename,
                            caption
                        );

                        return;
                    }

                    const gifAttr = doc.attributes?.find(
                        a => a instanceof Api.DocumentAttributeAnimated
                    );

                    if (gifAttr) {

                        await sendTelegramFile(
                            "sendAnimation",
                            "animation",
                            buffer,
                            "animation.gif",
                            caption
                        );

                        return;
                    }

                    const audioAttr = doc.attributes?.find(
                        a => a instanceof Api.DocumentAttributeAudio
                    );

                    /* VOICE NOTE */
                    if (audioAttr?.voice) {

                        await sendTelegramFile(
                            "sendVoice",
                            "voice",
                            buffer,
                            "voice.ogg"
                        );

                        return;
                    }

                    const fileNameAttr = doc.attributes?.find(
                        a => a instanceof Api.DocumentAttributeFilename
                    );

                    const fileName = fileNameAttr?.fileName || "file.bin";

                    await sendTelegramFile(
                        "sendDocument",
                        "document",
                        buffer,
                        fileName,
                        caption
                    );
                }

                /* OTHER FILES */
                await sendTelegramFile(
                    "sendDocument",
                    "document",
                    buffer,
                    "file",
                    caption
                );

            }

        } catch (err) {
            console.log("Error forwarding message:", err);
        }

    }, new NewMessage({ chats: Object.keys(channels).map(id => BigInt(id)) }));
}

startClient();