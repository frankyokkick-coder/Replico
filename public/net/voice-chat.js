// Live voice chat for REPLICO multiplayer rooms only. WebRTC mesh (every
// player connects directly to every other player), signaled over the SAME
// WebSocket the game already uses (new 'voice-signal' message type, relayed
// by server/wsServer.js - the server never inspects the payload).
//
// Purely additive: this file never calls into app.js or multiplayer.js. It
// reuses window.REPLICO_NET's raw socket (multiplayer-client.js exposes it
// via getSocket()) by adding its own independent addEventListener('message')
// listener - which coexists safely with multiplayer.js's existing net.on()
// handlers - and it drives its own mute logic purely by observing the same
// `.screen.active` / #turn-player-label DOM state multiplayer.js already
// renders. Single-player never triggers any of this, since voice chat only
// starts once a 'room-joined' message has actually been received.
(function () {
  'use strict';

  if (window.__REPLICO_VOICE_CHAT_INIT__) return;
  window.__REPLICO_VOICE_CHAT_INIT__ = true;

  // Public STUN (Google) plus a public, no-signup TURN fallback (Open Relay
  // Project) for players behind stricter NATs/firewalls where STUN alone
  // can't find a direct path. No account or payment involved on either.
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  ];

  const micBtn = document.getElementById('btn-voice-mute');

  let localStream = null;
  let myPlayerId = null;
  let userMuted = false;
  let autoMutedForRecording = false;
  let started = false;
  const peers = new Map(); // playerId -> RTCPeerConnection

  function applyMuteState() {
    if (!localStream) return;
    const shouldBeOn = !(userMuted || autoMutedForRecording);
    localStream.getAudioTracks().forEach((t) => { t.enabled = shouldBeOn; });
    if (micBtn) {
      micBtn.textContent = userMuted ? '🔇 UNMUTE' : '🎤 MUTE';
      micBtn.classList.toggle('muted', userMuted);
    }
  }

  function syncButtonVisibility() {
    if (micBtn) micBtn.style.display = started ? 'inline-flex' : 'none';
  }

  async function ensureLocalStream() {
    if (localStream) return localStream;
    // Deliberately a separate getUserMedia call from the game's recording
    // stream (recorder.js), with echo cancellation ON - the recording
    // pipeline needs it OFF for faithful scoring, but voice chat needs it
    // ON to avoid feedback/echo between players' speakers and mics.
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    applyMuteState();
    return localStream;
  }

  function sendSignal(targetPlayerId, signal) {
    const socket = window.REPLICO_NET.getSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'voice-signal', targetPlayerId, signal }));
    }
  }

  function removePeer(id) {
    const pc = peers.get(id);
    if (!pc) return;
    pc.close();
    peers.delete(id);
    const audioEl = document.getElementById('voice-audio-' + id);
    if (audioEl) {
      audioEl.pause();
      audioEl.srcObject = null;
      audioEl.remove();
    }
  }

  function createPeerConnection(remoteId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(remoteId, { kind: 'candidate', candidate: event.candidate });
    };

    // One <audio> element per remote peer, playing ONLY their stream - never
    // the local mic's own track - so there is no echo/duplicate playback.
    pc.ontrack = (event) => {
      let audioEl = document.getElementById('voice-audio-' + remoteId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = 'voice-audio-' + remoteId;
        audioEl.autoplay = true;
        audioEl.hidden = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = event.streams[0];
      audioEl.play().catch(() => {});
    };

    peers.set(remoteId, pc);
    return pc;
  }

  async function initiateConnection(remoteId) {
    const pc = createPeerConnection(remoteId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(remoteId, { kind: 'offer', sdp: pc.localDescription });
  }

  async function handleSignal(fromPlayerId, signal) {
    let pc = peers.get(fromPlayerId);

    if (signal.kind === 'offer') {
      if (!pc) pc = createPeerConnection(fromPlayerId);
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(fromPlayerId, { kind: 'answer', sdp: pc.localDescription });
    } else if (signal.kind === 'answer') {
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.kind === 'candidate' && pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch {
        // Late/duplicate candidates are harmless to drop.
      }
    }
  }

  async function reconcilePeers(playerIds) {
    const wanted = new Set(playerIds.filter((id) => id !== myPlayerId));

    for (const id of Array.from(peers.keys())) {
      if (!wanted.has(id)) removePeer(id);
    }

    for (const id of wanted) {
      if (peers.has(id)) continue;
      // Deterministic tie-break so both sides don't send an offer at once:
      // the lower playerId always initiates.
      if (myPlayerId < id) await initiateConnection(id);
    }
  }

  async function startVoiceChat(playerIds) {
    myPlayerId = window.REPLICO_NET.getPlayerId();
    if (!started) {
      started = true;
      syncButtonVisibility();
      try {
        await ensureLocalStream();
      } catch (err) {
        console.error('REPLICO voice chat: microphone unavailable', err);
      }
    }
    await reconcilePeers(playerIds);
  }

  function stopVoiceChat() {
    started = false;
    syncButtonVisibility();
    for (const id of Array.from(peers.keys())) removePeer(id);
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
  }

  // --- tap into the existing signaling socket without touching multiplayer.js ---

  function wireSocket() {
    const socket = window.REPLICO_NET.getSocket();
    if (!socket) return false;

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'room-joined') {
        startVoiceChat((msg.players || []).map((p) => p.id));
      } else if (msg.type === 'voice-signal') {
        handleSignal(msg.fromPlayerId, msg.signal);
      }
    });

    socket.addEventListener('close', stopVoiceChat);
    return true;
  }

  // The socket only exists after the player clicks HOST/JOIN (multiplayer.js
  // calls net.connect() at that point, which constructs the WebSocket
  // synchronously before returning). Wrap connect() so our listener is
  // attached the instant the socket exists - a poll here would race the
  // 'room-joined' reply on a fast (e.g. localhost) round-trip and could
  // miss it. This wraps the method on the existing window.REPLICO_NET
  // object; multiplayer.js calls net.connect() through that same object,
  // so it transparently goes through this wrapper too.
  const originalConnect = window.REPLICO_NET.connect;
  window.REPLICO_NET.connect = function (...args) {
    const result = originalConnect.apply(window.REPLICO_NET, args);
    wireSocket();
    return result;
  };
  // In case connect() was somehow already called before this script ran.
  wireSocket();

  // --- auto-mute for exactly the active player's own recording turn ---

  function syncAutoMute() {
    if (!started) return;
    const activeScreen = document.querySelector('.screen.active');
    const turnLabel = document.getElementById('turn-player-label');
    const isMyRecordTurn = !!activeScreen && activeScreen.id === 'screen-record' &&
      !!turnLabel && turnLabel.textContent === 'YOUR TURN';
    if (isMyRecordTurn !== autoMutedForRecording) {
      autoMutedForRecording = isMyRecordTurn;
      applyMuteState();
    }
  }

  const screenObserver = new MutationObserver(syncAutoMute);
  document.querySelectorAll('.screen').forEach((el) => {
    screenObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  const turnLabelEl = document.getElementById('turn-player-label');
  if (turnLabelEl) {
    const labelObserver = new MutationObserver(syncAutoMute);
    labelObserver.observe(turnLabelEl, { characterData: true, childList: true, subtree: true });
  }

  // --- manual mute/unmute control ---

  if (micBtn) {
    micBtn.addEventListener('click', () => {
      userMuted = !userMuted;
      applyMuteState();
    });
  }

  // Exposed for debugging/testing, matching this codebase's window.REPLICO_*
  // convention - not used by any other module.
  window.REPLICO_VOICE = { peers, isStarted: () => started };
})();
