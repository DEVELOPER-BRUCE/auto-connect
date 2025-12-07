import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import fs from 'fs';
import qrcode from 'qrcode';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  generatePairingCode,
  getContentType,
  DisconnectReason
} from '@whiskeysockets/baileys';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const sessionDir = path.join(__dirname, 'session');
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

let PAIRING_CODE = null;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  // Generate pairing code
  const { pairingCode } = await generatePairingCode({ auth: state });
  PAIRING_CODE = pairingCode;
  console.log('Your pairing code:', PAIRING_CODE);

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    browser: ["Status-Bot", "Chrome", "1.0"]
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('✅ WhatsApp Connected!');
      PAIRING_CODE = null; // clear code once connected
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('❌ Connection lost, reconnecting...');
        startBot();
      } else {
        console.log('❌ Logged out. Please pair again.');
      }
    }
  });

  // Auto react to statuses
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || msg.key.remoteJid !== 'status@broadcast') return;

    const contentType = getContentType(msg.message);
    const messageContent =
      contentType === 'ephemeralMessage'
        ? msg.message.ephemeralMessage.message
        : msg.message;

    const emojis = ['🔥', '💯', '💥', '😎', '❤️'];
    const react = emojis[Math.floor(Math.random() * emojis.length)];

    try {
      await sock.sendMessage(msg.key.remoteJid, {
        react: { text: react, key: msg.key }
      });
      console.log(`Reacted to status with ${react}`);
    } catch (e) {
      console.error('Failed to react:', e);
    }
  });
}

startBot();

// Web page showing pairing code
app.get('/', (req, res) => {
  if (PAIRING_CODE) {
    return res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center">
          <h2>Enter this pairing code in your WhatsApp mobile</h2>
          <h1 style="color:blue">${PAIRING_CODE}</h1>
        </body>
      </html>
    `);
  } else {
    return res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center">
          <h2>WhatsApp is connected!</h2>
          <p>Status viewing and auto-react enabled.</p>
        </body>
      </html>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
