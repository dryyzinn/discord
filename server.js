const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---- In-memory state (troque por um banco de dados real em produção) ----
const TEXT_CHANNELS = ['geral', 'aleatorio', 'projetos'];
const VOICE_CHANNELS = ['Sala de Voz 1', 'Sala de Voz 2'];

const messagesByChannel = {}; // { channelName: [{ id, username, text, ts }] }
TEXT_CHANNELS.forEach(c => (messagesByChannel[c] = []));

const users = {}; // socket.id -> { username, textChannel, voiceChannel }
const voiceMembers = {}; // channelName -> Set(socket.id)
VOICE_CHANNELS.forEach(c => (voiceMembers[c] = new Set()));

function voiceRoster(channel) {
  return [...voiceMembers[channel]].map(id => ({
    socketId: id,
    username: users[id]?.username || '???',
  }));
}

function broadcastPresence() {
  const online = Object.values(users).map(u => u.username);
  io.emit('presence:update', { online });
}

io.on('connection', socket => {
  socket.on('user:join', ({ username }) => {
    users[socket.id] = { username, textChannel: null, voiceChannel: null };
    socket.emit('bootstrap', {
      textChannels: TEXT_CHANNELS,
      voiceChannels: VOICE_CHANNELS,
      voiceRosters: Object.fromEntries(
        VOICE_CHANNELS.map(c => [c, voiceRoster(c)])
      ),
    });
    broadcastPresence();
  });

  // ---------- Chat de texto ----------
  socket.on('channel:join', ({ channel }) => {
    if (!TEXT_CHANNELS.includes(channel)) return;
    const u = users[socket.id];
    if (u) u.textChannel = channel;
    socket.emit('channel:history', {
      channel,
      messages: messagesByChannel[channel],
    });
  });

  socket.on('message:send', ({ channel, text }) => {
    const u = users[socket.id];
    if (!u || !TEXT_CHANNELS.includes(channel) || !text?.trim()) return;
    const msg = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      username: u.username,
      text: text.trim().slice(0, 2000),
      ts: Date.now(),
    };
    messagesByChannel[channel].push(msg);
    if (messagesByChannel[channel].length > 500) {
      messagesByChannel[channel].shift();
    }
    io.emit('message:new', { channel, message: msg });
  });

  // ---------- Voz / vídeo / tela (sinalização WebRTC, malha ponto-a-ponto) ----------
  socket.on('voice:join', ({ channel }) => {
    if (!VOICE_CHANNELS.includes(channel)) return;
    const u = users[socket.id];
    if (!u) return;

    // sai de outra sala de voz antes, se estiver em alguma
    if (u.voiceChannel && voiceMembers[u.voiceChannel]) {
      voiceMembers[u.voiceChannel].delete(socket.id);
      socket.to(u.voiceChannel).emit('voice:peer-left', { socketId: socket.id });
      socket.leave('voice:' + u.voiceChannel);
    }

    u.voiceChannel = channel;
    voiceMembers[channel].add(socket.id);
    socket.join('voice:' + channel);

    const existingPeers = voiceRoster(channel).filter(p => p.socketId !== socket.id);
    socket.emit('voice:peers', { channel, peers: existingPeers });
    socket.to('voice:' + channel).emit('voice:new-peer', {
      socketId: socket.id,
      username: u.username,
    });

    io.emit('voice:roster', { channel, roster: voiceRoster(channel) });
  });

  socket.on('voice:leave', () => {
    const u = users[socket.id];
    if (!u || !u.voiceChannel) return;
    const channel = u.voiceChannel;
    voiceMembers[channel].delete(socket.id);
    socket.leave('voice:' + channel);
    socket.to('voice:' + channel).emit('voice:peer-left', { socketId: socket.id });
    u.voiceChannel = null;
    io.emit('voice:roster', { channel, roster: voiceRoster(channel) });
  });

  // repassa sinalização WebRTC (offer/answer/ice candidates) entre pares
  socket.on('voice:signal', ({ to, signal }) => {
    io.to(to).emit('voice:signal', { from: socket.id, signal });
  });

  socket.on('voice:state', ({ muted, screenSharing, cameraOn }) => {
    const u = users[socket.id];
    if (!u || !u.voiceChannel) return;
    socket.to('voice:' + u.voiceChannel).emit('voice:peer-state', {
      socketId: socket.id,
      muted,
      screenSharing,
      cameraOn,
    });
  });

  socket.on('disconnect', () => {
    const u = users[socket.id];
    if (u?.voiceChannel) {
      voiceMembers[u.voiceChannel]?.delete(socket.id);
      socket.to('voice:' + u.voiceChannel).emit('voice:peer-left', { socketId: socket.id });
      io.emit('voice:roster', { channel: u.voiceChannel, roster: voiceRoster(u.voiceChannel) });
    }
    delete users[socket.id];
    broadcastPresence();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
