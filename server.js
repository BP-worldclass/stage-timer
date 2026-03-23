const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
const CONTROLLER_PASSWORD = '1234'; // 변경 가능

// 공유 상태
let state = {
  timers: [
    { id: 1, title: '오프닝', speaker: '사회자', duration: 5 },
    { id: 2, title: '키노트', speaker: '발표자', duration: 20 },
    { id: 3, title: 'Q&A', speaker: '전체', duration: 10 },
  ],
  curIdx: 0,
  remaining: 300,
  running: false,
  message: '',
  messageVisible: false,
  logo: '',
  warnSecs: 60,
  style: {
    timeSize: 22,
    titleSize: 3,
    speakerSize: 1.8,
    timeColor: '#ffffff',
    titleColor: 'rgba(255,255,255,0.6)',
    speakerColor: 'rgba(255,255,255,0.3)',
    warnColor: '#ffab40',
    negColor: '#ff1744',
    bgColor: '#000000',
    fontName: '',
    fontData: '',
  },
};

let tickInterval = null;
let nextId = 4;

function broadcast(data, skipWs) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== skipWs) {
      client.send(msg);
    }
  });
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function startTick() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    state.remaining--;
    broadcastAll({ type: 'tick', remaining: state.remaining });
  }, 1000);
}

function stopTick() {
  clearInterval(tickInterval);
  tickInterval = null;
}

wss.on('connection', (ws) => {
  // 접속 즉시 현재 상태 전송
  ws.send(JSON.stringify({ type: 'fullState', state }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'play':
        if (!state.timers.length) break;
        if (state.remaining === 0) state.remaining = state.timers[state.curIdx].duration * 60;
        state.running = true;
        startTick();
        broadcastAll({ type: 'play', remaining: state.remaining });
        break;

      case 'pause':
        state.running = false;
        stopTick();
        broadcastAll({ type: 'pause' });
        break;

      case 'reset':
        state.running = false;
        stopTick();
        if (state.timers[state.curIdx]) state.remaining = state.timers[state.curIdx].duration * 60;
        broadcastAll({ type: 'reset', remaining: state.remaining });
        break;

      case 'next':
        state.running = false;
        stopTick();
        if (state.curIdx < state.timers.length - 1) {
          state.curIdx++;
          state.remaining = state.timers[state.curIdx].duration * 60;
        }
        broadcastAll({ type: 'select', curIdx: state.curIdx, remaining: state.remaining });
        break;

      case 'select':
        state.running = false;
        stopTick();
        state.curIdx = msg.idx;
        state.remaining = state.timers[state.curIdx].duration * 60;
        broadcastAll({ type: 'select', curIdx: state.curIdx, remaining: state.remaining });
        break;

      case 'addTimer':
        const t = { id: nextId++, title: msg.title, speaker: msg.speaker, duration: msg.duration };
        state.timers.push(t);
        if (state.timers.length === 1) { state.curIdx = 0; state.remaining = t.duration * 60; }
        broadcastAll({ type: 'timers', timers: state.timers, curIdx: state.curIdx, remaining: state.remaining });
        break;

      case 'editTimer':
        const et = state.timers.find(x => x.id === msg.id);
        if (et) { et.title = msg.title; et.speaker = msg.speaker; et.duration = msg.duration; }
        if (state.timers[state.curIdx]?.id === msg.id) state.remaining = msg.duration * 60;
        broadcastAll({ type: 'timers', timers: state.timers, curIdx: state.curIdx, remaining: state.remaining });
        break;

      case 'deleteTimer':
        state.timers = state.timers.filter(x => x.id !== msg.id);
        if (state.curIdx >= state.timers.length) state.curIdx = Math.max(0, state.timers.length - 1);
        state.remaining = state.timers[state.curIdx] ? state.timers[state.curIdx].duration * 60 : 0;
        stopTick(); state.running = false;
        broadcastAll({ type: 'timers', timers: state.timers, curIdx: state.curIdx, remaining: state.remaining });
        break;

      case 'message':
        state.message = msg.text;
        state.messageVisible = msg.visible;
        broadcastAll({ type: 'message', text: msg.text, visible: msg.visible });
        break;

      case 'logo':
        state.logo = msg.data;
        broadcastAll({ type: 'logo', data: msg.data });
        break;

      case 'warnSecs':
        state.warnSecs = msg.value;
        broadcastAll({ type: 'warnSecs', value: msg.value });
        break;

      case 'style':
        state.style = { ...state.style, ...msg.data };
        broadcastAll({ type: 'style', data: state.style });
        break;
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));

// IP 자동 감지
const os = require('os');
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n=================================');
  console.log('  Stage Timer 서버 시작됨');
  console.log('=================================');
  console.log(`\n  📺 뷰어 (TV/미러링용)`);
  console.log(`     http://${ip}:${PORT}/viewer.html`);
  console.log(`\n  🎛  컨트롤러 (운영자용)`);
  console.log(`     http://${ip}:${PORT}/controller.html`);
  console.log(`\n  🔑 컨트롤러 비밀번호: ${CONTROLLER_PASSWORD}`);
  console.log('\n=================================\n');
});
