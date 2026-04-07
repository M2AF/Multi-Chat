/**
 * discord-bridge.js — criptoejesus MultiChat
 *
 * Connects to Discord's Gateway as a bot, listens for messages in the
 * configured channel, and forwards them to a local WebSocket server that
 * multichat.html connects to.
 *
 * Requirements:
 *   node >= 16
 *   npm install ws
 *
 * Run:
 *   node discord-bridge.js
 */

const WebSocket = require('ws');

// ── Load config ──────────────────────────────────────────────────────────────
let CONFIG;
try {
  // Node can't load a browser-style const CONFIG = {...} directly, so we eval it
  const fs   = require('fs');
  const raw  = fs.readFileSync('./config.js', 'utf8');
  // Strip the "const CONFIG = " prefix and trailing semicolon, then parse
  const json = raw.match(/const CONFIG\s*=\s*(\{[\s\S]*?\});/)[1];
  CONFIG = eval('(' + json + ')');
} catch (e) {
  console.error('❌  Could not load config.js:', e.message);
  process.exit(1);
}

const BOT_TOKEN  = CONFIG.DISCORD_BOT_TOKEN;
const CHANNEL_ID = CONFIG.DISCORD_CHANNEL_ID;
const WS_PORT    = 8081;

if (!BOT_TOKEN || BOT_TOKEN === 'REPLACE_WITH_NEW_TOKEN') {
  console.error('❌  Set DISCORD_BOT_TOKEN in config.js before running.');
  process.exit(1);
}

// ── Local WebSocket server (multichat.html connects here) ────────────────────
const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`🔗  MultiChat connected (${clients.size} client(s))`);
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`🔌  MultiChat disconnected (${clients.size} client(s))`);
  });
});

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

console.log(`✅  Bridge WS server listening on ws://127.0.0.1:${WS_PORT}`);

// ── Discord Gateway ──────────────────────────────────────────────────────────
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = 1 << 9 | 1 << 15; // GUILD_MESSAGES + MESSAGE_CONTENT

let heartbeatInterval = null;
let sequence         = null;
let discordWs        = null;

function connectDiscord() {
  console.log('🔄  Connecting to Discord Gateway…');
  discordWs = new WebSocket(DISCORD_GATEWAY);

  discordWs.on('open', () => {
    console.log('✅  Discord Gateway connected');
  });

  discordWs.on('message', (raw) => {
    const payload = JSON.parse(raw);
    const { op, d, s, t } = payload;

    if (s) sequence = s;

    // Op 10 — Hello: start heartbeating and identify
    if (op === 10) {
      const interval = d.heartbeat_interval;
      // Send first heartbeat immediately with a random jitter
      setTimeout(() => sendHeartbeat(), interval * Math.random());
      heartbeatInterval = setInterval(sendHeartbeat, interval);

      // Identify
      discordWs.send(JSON.stringify({
        op: 2,
        d: {
          token:   BOT_TOKEN,
          intents: INTENTS,
          properties: {
            os:      'linux',
            browser: 'multichat-bridge',
            device:  'multichat-bridge'
          }
        }
      }));
    }

    // Op 0 — Dispatch events
    if (op === 0) {
      if (t === 'READY') {
        console.log(`🤖  Logged in as ${d.user.username}#${d.user.discriminator}`);
        console.log(`👂  Listening for messages in channel ${CHANNEL_ID}`);
      }

      if (t === 'MESSAGE_CREATE') {
        // Only forward messages from the configured channel
        if (d.channel_id !== CHANNEL_ID) return;
        // Ignore bot messages (optional — remove this line to include bots)
        if (d.author.bot) return;

        const username = d.member?.nick || d.author.global_name || d.author.username;
        const text     = d.content;

        // Skip empty messages (e.g. image-only)
        if (!text) return;

        console.log(`💬  [Discord] ${username}: ${text}`);

        broadcast({
          platform: 'discord',
          username,
          text,
          avatar: d.author.avatar
            ? `https://cdn.discordapp.com/avatars/${d.author.id}/${d.author.avatar}.png`
            : null
        });
      }
    }

    // Op 7 — Reconnect requested
    if (op === 7) {
      console.log('🔁  Discord requested reconnect');
      reconnect();
    }

    // Op 9 — Invalid session
    if (op === 9) {
      console.warn('⚠️   Invalid session — reconnecting in 5s');
      setTimeout(connectDiscord, 5000);
    }
  });

  discordWs.on('close', (code) => {
    console.warn(`⚠️   Discord WS closed (${code}) — reconnecting in 5s`);
    clearInterval(heartbeatInterval);
    setTimeout(connectDiscord, 5000);
  });

  discordWs.on('error', (err) => {
    console.error('❌  Discord WS error:', err.message);
  });
}

function sendHeartbeat() {
  if (discordWs?.readyState === WebSocket.OPEN) {
    discordWs.send(JSON.stringify({ op: 1, d: sequence }));
  }
}

function reconnect() {
  clearInterval(heartbeatInterval);
  discordWs?.terminate();
  setTimeout(connectDiscord, 1000);
}

connectDiscord();
