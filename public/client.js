const socket = io();

// STUN público — ajuda a atravessar NAT. Para redes muito restritivas
// (ex: amigos em provedores/rede corporativa diferentes) pode ser necessário
// também um servidor TURN — veja o README.
const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

let myUsername = null;
let currentTextChannel = null;
let currentVoiceChannel = null;

let localStream = null; // microfone (+ câmera opcional)
let screenStream = null; // compartilhamento de tela
let micOn = false;
let camOn = false;
let screenOn = false;

const peers = {}; // socketId -> RTCPeerConnection
const usernamesById = {}; // socketId -> username (para exibir nas tiles)

// ---------------- LOGIN ----------------
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');

document.getElementById('login-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('username-input').value.trim();
  if (!name) return;
  myUsername = name;
  socket.emit('user:join', { username: name });
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  document.getElementById('me-username').textContent = name;
});

// ---------------- BOOTSTRAP / CANAIS ----------------
socket.on('bootstrap', ({ textChannels, voiceChannels, voiceRosters }) => {
  const textList = document.getElementById('text-channel-list');
  textList.innerHTML = '';
  textChannels.forEach(name => {
    const li = document.createElement('li');
    li.textContent = '# ' + name;
    li.dataset.channel = name;
    li.addEventListener('click', () => joinTextChannel(name));
    textList.appendChild(li);
  });

  const voiceList = document.getElementById('voice-channel-list');
  voiceList.innerHTML = '';
  voiceChannels.forEach(name => {
    const li = document.createElement('li');
    li.dataset.channel = name;
    const count = voiceRosters[name]?.length || 0;
    li.innerHTML = `<span>🔊 ${name}</span><span class="voice-count">${count}</span>`;
    li.addEventListener('click', () => joinVoiceChannel(name));
    voiceList.appendChild(li);
  });

  // entra automaticamente no primeiro canal de texto
  joinTextChannel(textChannels[0]);
});

socket.on('voice:roster', ({ channel, roster }) => {
  const li = document.querySelector(`#voice-channel-list li[data-channel="${CSS.escape(channel)}"]`);
  if (li) {
    const countEl = li.querySelector('.voice-count');
    if (countEl) countEl.textContent = roster.length;
  }
});

socket.on('presence:update', ({ online }) => {
  document.getElementById('online-count').textContent = online.length;
  const list = document.getElementById('online-list');
  list.innerHTML = '';
  online.forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    list.appendChild(li);
  });
});

// ---------------- CHAT DE TEXTO ----------------
function joinTextChannel(channel) {
  currentTextChannel = channel;
  document.getElementById('channel-title').textContent = '# ' + channel;
  document.querySelectorAll('#text-channel-list li').forEach(li => {
    li.classList.toggle('active', li.dataset.channel === channel);
  });
  socket.emit('channel:join', { channel });
}

socket.on('channel:history', ({ channel, messages }) => {
  if (channel !== currentTextChannel) return;
  const box = document.getElementById('messages');
  box.innerHTML = '';
  messages.forEach(renderMessage);
  box.scrollTop = box.scrollHeight;
});

socket.on('message:new', ({ channel, message }) => {
  if (channel !== currentTextChannel) return;
  renderMessage(message);
  const box = document.getElementById('messages');
  box.scrollTop = box.scrollHeight;
});

function renderMessage(msg) {
  const box = document.getElementById('messages');
  const el = document.createElement('div');
  el.className = 'message';
  const time = new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `
    <span class="msg-avatar"></span>
    <div class="msg-body">
      <div class="msg-head">
        <span class="msg-username">${escapeHtml(msg.username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-text">${escapeHtml(msg.text)}</div>
    </div>`;
  box.appendChild(el);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.getElementById('message-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value;
  if (!text.trim() || !currentTextChannel) return;
  socket.emit('message:send', { channel: currentTextChannel, text });
  input.value = '';
});

// ---------------- VOZ / VÍDEO / TELA ----------------
const voicePanel = document.getElementById('voice-panel');
const videoGrid = document.getElementById('video-grid');

async function joinVoiceChannel(channel) {
  if (currentVoiceChannel === channel) return;
  if (currentVoiceChannel) leaveVoiceChannel(false);

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    alert('Não foi possível acessar o microfone: ' + err.message);
    return;
  }
  micOn = true;
  camOn = false;

  currentVoiceChannel = channel;
  document.getElementById('voice-channel-name').textContent = '🔊 ' + channel;
  voicePanel.classList.remove('hidden');
  updateControlButtons();

  addLocalTile();

  document.querySelectorAll('#voice-channel-list li').forEach(li => {
    li.classList.toggle('in-voice', li.dataset.channel === channel);
  });

  socket.emit('voice:join', { channel });
}

function leaveVoiceChannel(notifyServer = true) {
  if (!currentVoiceChannel) return;
  if (notifyServer) socket.emit('voice:leave');

  Object.keys(peers).forEach(id => closePeer(id));
  stopStream(localStream);
  stopStream(screenStream);
  localStream = null;
  screenStream = null;
  micOn = false;
  camOn = false;
  screenOn = false;

  document.querySelectorAll('#voice-channel-list li').forEach(li => li.classList.remove('in-voice'));
  videoGrid.innerHTML = '';
  voicePanel.classList.add('hidden');
  currentVoiceChannel = null;
}

document.getElementById('leave-voice-btn').addEventListener('click', () => leaveVoiceChannel(true));

function stopStream(stream) {
  stream?.getTracks().forEach(t => t.stop());
}

// alguém já estava na sala quando eu entrei -> eu inicio a conexão com cada um
socket.on('voice:peers', ({ peers: existing }) => {
  existing.forEach(p => {
    usernamesById[p.socketId] = p.username;
    createPeerConnection(p.socketId, true);
    addRemoteTile(p.socketId, p.username);
  });
});

// alguém entrou depois de mim -> eu apenas espero a oferta dele
socket.on('voice:new-peer', ({ socketId, username }) => {
  usernamesById[socketId] = username;
  createPeerConnection(socketId, false);
  addRemoteTile(socketId, username);
});

socket.on('voice:peer-left', ({ socketId }) => {
  closePeer(socketId);
  removeTile(socketId);
});

socket.on('voice:signal', async ({ from, signal }) => {
  let pc = peers[from];
  if (!pc) pc = createPeerConnection(from, false);

  if (signal.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('voice:signal', { to: from, signal: pc.localDescription });
  } else if (signal.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal));
  } else if (signal.candidate) {
    try { await pc.addIceCandidate(signal); } catch (e) { /* ignora candidatos fora de ordem */ }
  }
});

socket.on('voice:peer-state', ({ socketId, muted, screenSharing }) => {
  const tile = document.getElementById('tile-' + socketId);
  if (tile) tile.classList.toggle('muted', muted);
});

function createPeerConnection(socketId, isInitiator) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[socketId] = pc;

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('voice:signal', { to: socketId, signal: e.candidate });
  };

  pc.ontrack = e => {
    const tile = document.getElementById('tile-' + socketId);
    if (!tile) return;
    let video = tile.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      tile.prepend(video);
      tile.querySelector('.tile-avatar')?.classList.add('hidden');
    }
    video.srcObject = e.streams[0];
  };

  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice:signal', { to: socketId, signal: pc.localDescription });
      } catch (err) { console.error(err); }
    };
  }

  return pc;
}

function closePeer(socketId) {
  const pc = peers[socketId];
  if (pc) {
    pc.close();
    delete peers[socketId];
  }
}

// ---------------- TILES DE VÍDEO ----------------
function addLocalTile() {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = 'tile-local';
  tile.innerHTML = `<span class="tile-avatar"></span><span class="tile-label">${escapeHtml(myUsername)} (você)</span>`;
  videoGrid.prepend(tile);
}

function addRemoteTile(socketId, username) {
  if (document.getElementById('tile-' + socketId)) return;
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = 'tile-' + socketId;
  tile.innerHTML = `<span class="tile-avatar"></span><span class="tile-label">${escapeHtml(username)}</span>`;
  videoGrid.appendChild(tile);
}

function removeTile(socketId) {
  document.getElementById('tile-' + socketId)?.remove();
}

// ---------------- CONTROLES ----------------
const micBtn = document.getElementById('toggle-mic-btn');
const camBtn = document.getElementById('toggle-cam-btn');
const screenBtn = document.getElementById('toggle-screen-btn');

function updateControlButtons() {
  micBtn.classList.toggle('active', !micOn);
  camBtn.classList.toggle('on', camOn);
  screenBtn.classList.toggle('on', screenOn);
}

micBtn.addEventListener('click', () => {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => (t.enabled = micOn));
  updateControlButtons();
  socket.emit('voice:state', { muted: !micOn, screenSharing: screenOn, cameraOn: camOn });
});

camBtn.addEventListener('click', async () => {
  if (!currentVoiceChannel) return;
  camOn = !camOn;
  if (camOn) {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = camStream.getVideoTracks()[0];
      localStream.addTrack(track);
      Object.values(peers).forEach(pc => pc.addTrack(track, localStream));
      const localTile = document.getElementById('tile-local');
      let video = localTile.querySelector('video');
      if (!video) {
        video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        localTile.prepend(video);
        localTile.querySelector('.tile-avatar')?.classList.add('hidden');
      }
      video.srcObject = new MediaStream([track]);
    } catch (err) {
      alert('Não foi possível acessar a câmera: ' + err.message);
      camOn = false;
    }
  } else {
    localStream.getVideoTracks().forEach(t => {
      t.stop();
      localStream.removeTrack(t);
    });
    document.getElementById('tile-local').querySelector('video')?.remove();
    document.getElementById('tile-local').querySelector('.tile-avatar')?.classList.remove('hidden');
  }
  updateControlButtons();
  socket.emit('voice:state', { muted: !micOn, screenSharing: screenOn, cameraOn: camOn });
});

screenBtn.addEventListener('click', async () => {
  if (!currentVoiceChannel) return;
  if (!screenOn) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (err) {
      return; // usuário cancelou o seletor de tela
    }
    const screenTrack = screenStream.getVideoTracks()[0];
    screenOn = true;

    // troca a faixa de vídeo enviada para todos os pares pela tela
    Object.values(peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
      else pc.addTrack(screenTrack, screenStream);
    });

    const localTile = document.getElementById('tile-local');
    let video = localTile.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      localTile.prepend(video);
    }
    video.srcObject = screenStream;
    localTile.querySelector('.tile-avatar')?.classList.add('hidden');

    // se o usuário clicar em "Parar compartilhamento" na barra do navegador
    screenTrack.onended = () => stopScreenShare();
  } else {
    stopScreenShare();
  }
  updateControlButtons();
  socket.emit('voice:state', { muted: !micOn, screenSharing: screenOn, cameraOn: camOn });
});

function stopScreenShare() {
  stopStream(screenStream);
  screenStream = null;
  screenOn = false;

  const camTrack = localStream?.getVideoTracks()[0];
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      if (camTrack) sender.replaceTrack(camTrack);
      else pc.removeTrack(sender);
    }
  });

  const localTile = document.getElementById('tile-local');
  const video = localTile?.querySelector('video');
  if (camTrack) {
    if (video) video.srcObject = new MediaStream([camTrack]);
  } else {
    video?.remove();
    localTile?.querySelector('.tile-avatar')?.classList.remove('hidden');
  }
  updateControlButtons();
}
