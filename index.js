import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  getContentType,
  DisconnectReason
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const sessionDir = path.join(__dirname, 'session');
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

let QR_IMAGE = null;
let PAIRING_CODE = null;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    browser: ["Status-Bot", "Chrome", "1.0"]
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, pairing, lastDisconnect } = update;

    if (qr) {
      PAIRING_CODE = null;
      QR_IMAGE = await qrcode.toDataURL(qr);
      console.log('QR code generated');
    } else if (pairing && pairing.code) {
      QR_IMAGE = null;
      PAIRING_CODE = pairing.code;
      console.log('Pairing code:', PAIRING_CODE);
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp Connected!');
      QR_IMAGE = null;
      PAIRING_CODE = null;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('❌ Connection lost, reconnecting...');
        startBot();
      } else {
        console.log('❌ Logged out. Please delete session and scan again.');
      }
    }
  });

  // Auto view/react to status
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
        react: {
          text: react,
          key: msg.key
        }
      });
      console.log(`Reacted to status with ${react}`);
    } catch (e) {
      console.error('Failed to react:', e);
    }
  });
}

startBot();

app.get('/', (req, res) => {
  if (QR_IMAGE) {
    return res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center">
          <h2>Scan this QR code with WhatsApp</h2>
          <img src="${QR_IMAGE}" />
          <p>Or use pairing code below (if available):</p>
          <h1 style="color:blue">${PAIRING_CODE ?? '-'}</h1>
        </body>
      </html>
    `);
  } else if (PAIRING_CODE) {
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
