// match3-server/server.mjs
// 三消对战 WebSocket 服务器 — 实时分数同步模式
// 启动: node server.mjs [port]

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2]) || 3001;

// HTTP server for static files
const httpServer = createServer((req, res) => {
  // Serve logo image for watermark
  if (req.url.startsWith('/logo.png')) {
    const imgPath = join(__dirname, 'logo.png');
    if (existsSync(imgPath)) {
      const img = readFileSync(imgPath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache, max-age=0' });
      res.end(img);
      return;
    }
  }
  let filePath = join(__dirname, req.url === '/' ? 'match3-multiplayer.html' : req.url);
  if (!filePath.endsWith('.html')) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not Found'); return; }
  const html = readFileSync(filePath, 'utf8');
  const host = req.headers.host || 'localhost:' + PORT;
  const wsUrl = host.includes('localhost') ? `ws://${host}` : `wss://${host}`;
  const patched = html.replace('const SERVER_URL =', `const SERVER_URL = '${wsUrl}'; //`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(patched);
});

const wss = new WebSocketServer({ server: httpServer });

// ─── Room State ─────────────────────────────────────────
const rooms = new Map(); // code -> { players: [conn, conn], board }

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function broadcast(room, msg, exclude = null) {
  const data = JSON.stringify(msg);
  for (const conn of room.players) {
    if (conn && conn !== exclude && conn.readyState === 1) {
      conn.send(data);
    }
  }
}

// ─── Connection Handler ─────────────────────────────────
wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerIndex = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch(e) { return; }

    switch (msg.type) {

      case 'create_room': {
        if (currentRoom) return;
        const code = genCode();
        const room = { code, players: [ws, null], board: null, scoreLimit: msg.scoreLimit || 3000 };
        rooms.set(code, room);
        currentRoom = room;
        playerIndex = 0;
        ws.send(JSON.stringify({ type: 'room_created', code }));
        console.log(`Room ${code} created (score limit: ${room.scoreLimit})`);
        break;
      }

      case 'join_room': {
        if (currentRoom) return;
        const room = rooms.get(msg.code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在或已满' }));
          return;
        }
        if (room.players[1]) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
          return;
        }
        room.players[1] = ws;
        currentRoom = room;
        playerIndex = 1;
        ws.send(JSON.stringify({ type: 'joined', code: msg.code, yourIndex: 1 }));

        // Notify both players: game starts
        const startMsg = { type: 'game_start', board: null, playerIndex: 0, scoreLimit: room.scoreLimit };
        room.players[0].send(JSON.stringify(startMsg));

        const startMsg2 = { type: 'game_start', board: null, playerIndex: 1, scoreLimit: room.scoreLimit };
        room.players[1].send(JSON.stringify(startMsg2));

        console.log(`Room ${msg.code} joined, game started (real-time mode)`);
        break;
      }

      case 'score_update': {
        // Relay score to the other player
        if (!currentRoom || playerIndex < 0) return;
        const other = currentRoom.players[1 - playerIndex];
        if (other && other.readyState === 1) {
          other.send(JSON.stringify({
            type: 'score_update',
            scores: msg.scores,
          }));
        }
        break;
      }

      case 'game_over': {
        if (!currentRoom) return;
        broadcast(currentRoom, {
          type: 'game_result',
          winner: playerIndex,
          scores: msg.scores,
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      const code = currentRoom.code;
      const other = currentRoom.players[1 - playerIndex];
      if (other && other.readyState === 1) {
        other.send(JSON.stringify({ type: 'opponent_left' }));
      }
      rooms.delete(code);
      console.log(`Room ${code} closed`);
    }
  });

  ws.send(JSON.stringify({ type: 'connected' }));
});

httpServer.listen(PORT, () => {
  console.log(`Match3 server (real-time) ready at http://localhost:${PORT}`);
  console.log(`Share this URL to play`);
});
