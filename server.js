// PhotoParty - 同じ部屋にいる仲間で写真を見せ合うアプリ
// 写真はサーバのRAMを経由するだけで、ディスクには一切保存しない
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  const fp = path.join(PUBLIC, path.normalize(file));
  if (!fp.startsWith(PUBLIC) || !fs.existsSync(fp)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

// 動画32MBまで許可。base64は約1.34倍に膨らむので受信上限は48MBに
const wss = new WebSocketServer({ server, maxPayload: 48 * 1024 * 1024 });

// rooms: code -> { clients: Map(id -> {ws, name}), queue: [item], current: item|null, hostId, history: [item] }
// item: { qid, ownerId, ownerName, effect, image }
const rooms = new Map();
let nextId = 1;
let nextQid = 1;

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const { ws } of room.clients.values()) if (ws.readyState === 1) ws.send(data);
}

// 画像を除いた部屋の状態（メンバー・キュー）を全員に配る
function broadcastState(room) {
  broadcast(room, {
    type: 'state',
    members: [...room.clients.entries()].map(([id, c]) => ({ id, name: c.name, isHost: id === room.hostId, posted: c.posted || 0, reactions: c.reactions || 0 })),
    queue: room.queue.map(q => ({ qid: q.qid, ownerId: q.ownerId, ownerName: q.ownerName, effect: q.effect })),
    current: room.current ? { ownerId: room.current.ownerId, ownerName: room.current.ownerName } : null,
    hasPrev: room.history.length > 0,
    totals: { posted: room.totalPosted || 0, reactions: room.totalReactions || 0 },
  });
}

// 表示時間(hold): 待ち枚数が多い時だけざっくり段階的に短縮。下限2秒
// 演出(lead)は表示時間(hold)と別勘定 — カウントは画像が見えてから始まる
const BASE_MS = +process.env.PP_BASE_MS || 3500;
// 各エフェクトで画像が完全に見えるまでの時間(ms)。CSSアニメの長さと同期させること
const FX_LEAD = { countdown: 3200, fade: 3000, explosion: 900, blur: 2600, zoom: 900, curtain: 2400, glitch: 1400, spot: 3000 };
// 効果ごとの表示時間(hold)調整。そのまま/カウントダウンは等倍、じわりは+1秒、爆発は1/4（写真のみ適用）
function adjustHold(effect, hold) {
  if (effect === 'fade') return hold + 1000;
  if (effect === 'explosion') return Math.round(hold * 0.25);
  return hold;
}

// 待ち枚数 → 表示時間。10枚未満は通常、そこから段階的に短縮、80枚以上は2秒固定
function holdMs(room) {
  const n = room.queue.length;
  let ms;
  if (n < 10) ms = BASE_MS;      //  0〜9枚: 通常(3.5秒)
  else if (n < 20) ms = 3000;    // 10〜19枚: 3秒
  else if (n < 40) ms = 2600;    // 20〜39枚: 2.6秒
  else if (n < 80) ms = 2200;    // 40〜79枚: 2.2秒
  else ms = 2000;                // 80枚以上: 2秒(下限)
  return Math.min(ms, BASE_MS);  // BASE_MSを下げた時(テスト等)は各段も追随
}

function showItem(room, item, effect) {
  // 動画は実尺ぶん表示（下限は通常hold、上限20秒）。写真は効果ごとにhold調整
  const hold = item.kind === 'video'
    ? Math.min(Math.max(Math.round(item.duration * 1000), holdMs(room)), 20000)
    : adjustHold(effect, holdMs(room));
  const lead = FX_LEAD[effect] || 0;
  broadcast(room, { type: 'show', image: item.image, kind: item.kind, effect, ownerId: item.ownerId, ownerName: item.ownerName, lead, hold });
  room.timer = setTimeout(() => advance(room), lead + hold);
}

function advance(room) {
  clearTimeout(room.timer);
  if (room.current) {
    room.history.push(room.current);
    if (room.history.length > 9) room.history.shift(); // 直近9枚だけRAMに保持
  }
  const item = room.queue.shift();
  if (item) {
    room.current = item;
    showItem(room, item, item.effect);
  } else {
    room.current = null;
    broadcast(room, { type: 'idle', recent: recentPayload(room) });
  }
  broadcastState(room);
}

// idle画面用: 直近6枚のサムネイル一覧（新しい順）
function recentPayload(room) {
  return [...room.history].reverse().slice(0, 6).map(h => ({ image: h.image, kind: h.kind, ownerName: h.ownerName }));
}

wss.on('connection', (ws) => {
  const id = nextId++;
  let room = null;
  let roomCode = null;

  // サーバ側からもWSプロトコルpingで経路を維持
  const hb = setInterval(() => { if (ws.readyState === 1) ws.ping(); }, 30000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const name = String(msg.name || '').slice(0, 20) || 'ゲスト';

    if (msg.type === 'create') {
      roomCode = makeCode();
      room = { clients: new Map(), queue: [], current: null, hostId: id, history: [], totalPosted: 0, totalReactions: 0, exifLog: [] };
      rooms.set(roomCode, room);
      room.clients.set(id, { ws, name, posted: 0, reactions: 0 });
      send(ws, { type: 'joined', room: roomCode, id, isHost: true });
      broadcastState(room);

    } else if (msg.type === 'join') {
      const code = String(msg.room || '').toUpperCase();
      room = rooms.get(code);
      if (!room) { send(ws, { type: 'error', message: '部屋が見つからない。コードを確認して。' }); room = null; return; }
      roomCode = code;
      room.clients.set(id, { ws, name, posted: 0, reactions: 0 });
      send(ws, { type: 'joined', room: roomCode, id, isHost: false });
      // 途中参加者にも現在の状況を見せる（表示中なら即表示、idleならサムネイル一覧）
      if (room.current) send(ws, { type: 'show', image: room.current.image, kind: room.current.kind, effect: 'none', ownerId: room.current.ownerId, ownerName: room.current.ownerName });
      else if (room.history.length) send(ws, { type: 'idle', recent: recentPayload(room) });
      // 既存メンバーに入室を通知（本人以外）
      const joinMsg = JSON.stringify({ type: 'notice', kind: 'join', name });
      for (const [cid, c] of room.clients) if (cid !== id && c.ws.readyState === 1) c.ws.send(joinMsg);
      broadcastState(room);

    } else if (msg.type === 'ping') {
      // クライアントの生存確認 + 無通信タイムアウト(Cloudflare約100秒)対策
      send(ws, { type: 'pong' });

    } else if (!room) {
      return;

    } else if (msg.type === 'enqueue') {
      if (typeof msg.image !== 'string') return;
      const isVideo = msg.image.startsWith('data:video/');
      if (!isVideo && !msg.image.startsWith('data:image/')) return;
      room.queue.push({
        qid: nextQid++, ownerId: id, ownerName: room.clients.get(id).name,
        effect: String(msg.effect || 'none'), image: msg.image,
        kind: isVideo ? 'video' : 'image', duration: Math.max(0, +msg.duration || 0),
      });
      room.clients.get(id).posted++;
      room.totalPosted++;
      // EXIF等のメタをログに記録（画像本体は保持しない）。直近200件
      const meta = msg.meta && typeof msg.meta === 'object' ? msg.meta : {};
      room.exifLog.push({
        ts: Date.now(), ownerName: room.clients.get(id).name,
        kind: isVideo ? 'video' : 'image',
        name: String(meta.name || '').slice(0, 120),
        size: Math.max(0, +meta.size || 0),
        exif: meta.exif && typeof meta.exif === 'object' ? meta.exif : null,
      });
      if (room.exifLog.length > 200) room.exifLog.shift();
      if (!room.current) advance(room);
      else broadcastState(room);

    } else if (msg.type === 'getlog') {
      send(ws, { type: 'log', entries: room.exifLog });

    } else if (msg.type === 'cancel') {
      room.queue = room.queue.filter(q => !(q.qid === msg.qid && q.ownerId === id));
      broadcastState(room);

    } else if (msg.type === 'prev') {
      // 1枚前に戻る。表示中のものはキューの先頭に戻し、戻った写真は演出なしで即表示
      if (!room.history.length) return;
      clearTimeout(room.timer);
      if (room.current) room.queue.unshift(room.current);
      room.current = room.history.pop();
      showItem(room, room.current, 'none');
      broadcastState(room);

    } else if (msg.type === 'react') {
      room.totalReactions++;
      // 表示中の写真の投稿者が「もらったいいね」としてカウント
      if (room.current) { const owner = room.clients.get(room.current.ownerId); if (owner) owner.reactions++; }
      broadcast(room, { type: 'react', emoji: String(msg.emoji || '').slice(0, 8), from: room.clients.get(id).name });
      broadcastState(room);
    }
  });

  ws.on('close', () => {
    clearInterval(hb);
    if (!room) return;
    room.clients.delete(id);
    room.queue = room.queue.filter(q => q.ownerId !== id);
    if (room.clients.size === 0) { clearTimeout(room.timer); rooms.delete(roomCode); return; }
    if (room.hostId === id) room.hostId = room.clients.keys().next().value;
    // 表示中の写真は自動送りタイマーに任せる（投稿者が抜けても表示時間ぶんは見せる）
    broadcastState(room);
  });
});

server.listen(PORT, () => console.log(`PhotoParty: http://localhost:${PORT}`));
