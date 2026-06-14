/**
 * Kaizo hang + chat ügynökök: állapot a böngészőben; beszélgetés háttér-API-val.
 * Könnyebb path: állítsd a #kaizo-ai-agents data-agent-api értékét és engedélyezd a CORS-t a szerveren.
 */
(() => {
  const FALLBACK_ORIGIN = 'https://aivio3.netlify.app';

  const LEGACY_API_HOSTS = [
    'aivio-592551502751.europe-central2.run.app',
    'europe-central2.run.app'
  ];

  function normalizeApiOrigin(raw) {
    let origin = (raw || '').replace(/\/$/, '') || FALLBACK_ORIGIN;
    try {
      const host = new URL(origin).hostname.toLowerCase();
      if (LEGACY_API_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
        return FALLBACK_ORIGIN;
      }
    } catch (_) {
      return FALLBACK_ORIGIN;
    }
    return origin;
  }

  function apiOrigin() {
    const raw =
      document.getElementById('kaizo-ai-agents')?.getAttribute?.('data-agent-api')?.trim?.() || '';
    return normalizeApiOrigin(raw);
  }

  const api = (path) => apiOrigin() + (path.startsWith('/') ? path : '/' + path);

  const VOICE_ID = '7B7mSWflzRSaO1yGeJH6';
  const TTS_MODEL = 'eleven_flash_v2_5';

  const ABS_MAX_LISTEN_MS = 38000;
  const SILENCE_AFTER_WORD_MS = 1800;
  const MAX_SILENT_TURNS = 6;

  const el = (id) => document.getElementById(id);

  let chatEl,
    statusEl,
    loopEl,
    dotEl,
    revEl,
    backendEl,
    activeNameEl,
    activeKeyEl,
    inputEl;

  let activeRobotKey = null;
  let activeRobotTitle = null;
  let running = false;
  let busy = false;
  let history = [];
  let activeAudio = null;
  let micStream = null;
  let silentTurns = 0;

  function english() {
    return document.documentElement.lang === 'en';
  }

  function t(code) {
    const en = english();
    const M = {
      pickRobot: en ? 'Pick an agent card first.' : 'Válassz előbb egy ügynököt.',
      robotsFail: en
        ? 'Cannot load robots (/robots). Enable CORS on the API host for this origin.'
        : 'Nem érem el az ügynök-listát (/robots). Engedélyezd az API gépen a CORS-t ennél az oldalon.',
      ttsFail: en ? 'TTS playback failed.' : 'A felolvasás (TTS) nem járt el.',
      stopSilent: en
        ? 'No speech — stopping. Tap an agent again to resume.'
        : 'Nincs beszédbejegyzés — leállok. Nyomj új ügynök kártyát a folytatáshoz.',
      errMeta: en ? 'Error' : 'Hiba',
      agentMeta: en ? 'Agents' : 'Ügynökök',
      youMeta: en ? 'You' : 'Te',
      interruptMeta: en ? 'You (interrupted)' : 'Te (megszólaltál)',
    };
    return M[code] || code;
  }

  function setStatus(kind, text) {
    if (!statusEl || !dotEl) return;
    statusEl.textContent = text;
    dotEl.classList.toggle('err', kind === 'err');
  }

  function setLoopState(state) {
    if (loopEl) loopEl.textContent = state;
  }

  function addMsg(who, body, meta) {
    if (!chatEl) return;
    const row = document.createElement('div');
    row.className = 'kaizo-agent-msg kaizo-agent-msg--' + (who === 'me' ? 'me' : 'ai');
    row.innerHTML = `<div class="kaizo-agent-msgmeta">${escapeHtml(meta)}</div>${escapeHtml(body)}`;
    chatEl.appendChild(row);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function apiJSON(url, payload) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok)
      throw new Error(url + ' ' + r.status + ' ' + (await r.text().catch(() => '')));
    return r.json();
  }

  function haltAudio() {
    if (!activeAudio) return;
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch (e) {}
    activeAudio = null;
  }

  async function micStreamAcquire() {
    if (micStream) return micStream;
    const g = navigator.mediaDevices?.getUserMedia;
    if (!g) throw new Error(english() ? 'Microphone unsupported.' : 'Nincs mikrofon támogatás.');
    micStream = await g({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    return micStream;
  }

  async function bargeProbe(audioEl) {
    try {
      const stream = await micStreamAcquire();
      const ACtx = window.AudioContext || window.webkitAudioContext;
      if (!ACtx) return false;
      const ctx = new ACtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      return await new Promise((resolve) => {
        let speechFrames = 0;
        const tick = () => {
          if (audioEl.paused || audioEl.ended) {
            resolve(false);
            return;
          }
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          if (rms > 0.055) speechFrames += 1;
          else speechFrames = Math.max(0, speechFrames - 1);
          if (speechFrames >= 4) {
            resolve(true);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    } catch (e) {
      return false;
    }
  }

  async function playTtsChunk(text, opts) {
    const allowIn = opts?.allowBargeIn !== false;
    setLoopState('SPEAKING');
    const r = await fetch(api('/speak'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: VOICE_ID, model_id: TTS_MODEL }),
    });
    if (!r.ok) throw new Error(await r.text().catch(() => ''));

    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const au = new Audio(u);
    activeAudio = au;

    const interrupted = await new Promise((resolve, reject) => {
      au.onended = () => resolve(false);
      au.onerror = reject;
      au.play()
        .then(async () => {
          if (!allowIn) return;
          const bump = await bargeProbe(au);
          if (bump && !au.paused && !au.ended) {
            try {
              au.pause();
            } catch (e) {}
            resolve(true);
          }
        })
        .catch(reject);
    });

    if (activeAudio === au) activeAudio = null;
    URL.revokeObjectURL(u);
    return { interrupted };
  }

  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recObj = null;
  let recLock = false;

  async function listenOnce() {
    if (recLock) return '';
    if (!Rec) throw new Error(english() ? 'Use Chrome for speech input.' : 'Beszédfelismeréshez Chrome ajánlott.');
    for (let k = 0; k < 5 && running; k++) {
      const line = await listenSegment();
      if (!running) return '';
      if (line.trim()) return line.trim();
      await new Promise((r) => setTimeout(r, 350));
    }
    return '';
  }

  function listenSegment() {
    if (recLock) return Promise.resolve('');
    if (recObj) {
      try {
        recObj.abort();
      } catch (e) {}
      recObj = null;
    }

    const r = new Rec();
    r.lang = 'hu-HU';
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    recObj = r;
    recLock = true;
    setLoopState('LISTENING');

    return new Promise((resolve, reject) => {
      let done = false;
      let finals = '';
      let interim = '';
      let silenceT = null;
      const wipeSilence = () => {
        if (silenceT) {
          clearTimeout(silenceT);
          silenceT = null;
        }
      };

      const textOut = () => (finals + interim).trim();

      const finalize = (out, error) => {
        if (done) return;
        done = true;
        wipeSilence();
        clearTimeout(hardStop);
        try {
          r.abort();
        } catch (e) {}
        recObj = null;
        recLock = false;
        if (error) reject(error);
        else resolve((out || '').trim());
      };

      const armSilence = () => {
        wipeSilence();
        silenceT = setTimeout(() => finalize(textOut()), SILENCE_AFTER_WORD_MS);
      };

      const hardStop = setTimeout(() => finalize(textOut()), ABS_MAX_LISTEN_MS);

      r.onresult = (ev) => {
        let f = '';
        let i = '';
        for (let j = 0; j < ev.results.length; j++) {
          const row = ev.results[j];
          if (row.isFinal) f += row[0].transcript;
          else i += row[0].transcript;
        }
        finals = f;
        interim = i;
        if (textOut()) armSilence();
      };

      r.onerror = (ev) => {
        const c = ev.error || '?';
        if (c === 'aborted' || c === 'no-speech') {
          finalize(textOut());
          return;
        }
        finalize('', new Error('STT: ' + c));
      };

      r.onend = () => {
        if (done) return;
        finalize(textOut());
      };

      try {
        r.start();
      } catch (err) {
        finalize('', err);
      }
    });
  }

  async function thinkLine(text) {
    setLoopState('THINK');
    const data = await apiJSON(api('/think'), { text, robot: activeRobotKey, history });
    return data.text || '';
  }

  async function handleLine(userText, meta) {
    addMsg('me', userText, meta);
    history.push({ role: 'user', content: userText });
    const reply = await thinkLine(userText);
    if (!running) return {};
    addMsg('ai', reply, activeRobotTitle || 'AI');
    history.push({ role: 'assistant', content: reply });
    return playTtsChunk(reply, { allowBargeIn: true });
  }

  async function mainLoop(seed) {
    if (!running || busy) return;
    busy = true;
    try {
      let cur = (seed || '').trim();

      while (running) {
        if (!cur) {
          cur = await listenOnce();
          if (!running) {
            busy = false;
            return;
          }
          if (!cur) {
            silentTurns += 1;
            if (silentTurns >= MAX_SILENT_TURNS) {
              addMsg('ai', t('stopSilent'), t('agentMeta'));
              halt();
              return;
            }
            busy = false;
            setTimeout(mainLoop, 200);
            return;
          }
        }

        silentTurns = 0;
        const meta = cur === seed && seed ? t('interruptMeta') : t('youMeta');
        const spoken = await handleLine(cur, meta);
        if (!running) {
          busy = false;
          return;
        }
        if (spoken?.interrupted) {
          cur = (await listenOnce()) || '';
          continue;
        }
        break;
      }

      busy = false;
      setTimeout(mainLoop, 150);
    } catch (err) {
      console.error(err);
      setStatus('err', 'ERROR');
      setLoopState('ERROR');
      addMsg('ai', (err && err.message) ? err.message : String(err), t('errMeta'));
      busy = false;
      running = false;
    }
  }

  async function startAgent(robotKey, robotTitle, intro) {
    document.querySelectorAll('.kaizo-agent-picker .kaizo-agent-card').forEach((c) =>
      c.classList.toggle('is-active', c.getAttribute('data-robot') === robotKey),
    );
    activeRobotKey = robotKey;
    activeRobotTitle = robotTitle;
    if (activeNameEl) activeNameEl.textContent = robotTitle;
    if (activeKeyEl) activeKeyEl.textContent = '(' + robotKey + ')';

    setStatus('ok', 'RUN');
    running = true;
    busy = false;
    silentTurns = 0;

    addMsg('ai', intro, robotTitle);
    history = [{ role: 'assistant', content: intro }];

    try {
      await playTtsChunk(intro, { allowBargeIn: true });
    } catch (err) {
      console.error(err);
      addMsg('ai', t('ttsFail'), t('errMeta'));
      running = false;
      setStatus('err', 'ERROR');
      setLoopState('ERROR');
      return;
    }

    busy = false;
    mainLoop();
  }

  async function sendTyped() {
    if (!inputEl) return;
    const v = inputEl.value.trim();
    if (!v) return;
    inputEl.value = '';
    if (!activeRobotKey) {
      addMsg('ai', t('pickRobot'), t('agentMeta'));
      return;
    }

    addMsg('me', v, t('youMeta'));
    history.push({ role: 'user', content: v });

    try {
      const answer = await thinkLine(v);
      addMsg('ai', answer, activeRobotTitle || 'AI');
      history.push({ role: 'assistant', content: answer });
      const spoken = await playTtsChunk(answer, { allowBargeIn: true });
      if (spoken?.interrupted) mainLoop((await listenOnce()) || '');
    } catch (err) {
      addMsg('ai', err.message || String(err), t('errMeta'));
    }
  }

  function halt() {
    running = false;
    busy = false;
    haltAudio();
    silentTurns = 0;
    setLoopState('IDLE');
    setStatus('ok', 'IDLE');
    try {
      if (recObj) recObj.abort();
    } catch (e) {}
    recObj = null;
    recLock = false;
  }

  function wireThumbs() {
    const origin = apiOrigin();
    document.querySelectorAll('.kaizo-agent-picker .kaizo-agent-card[data-img]').forEach((card) => {
      const img = card.querySelector('.kaizo-agent-thumb img');
      const p = card.getAttribute('data-img');
      if (img && p) img.src = origin + (p.startsWith('/') ? p : '/' + p);
    });
  }

  function bind() {
    chatEl = el('kaizo-agent-chat');
    statusEl = el('kaizo-agent-status');
    loopEl = el('kaizo-agent-loop');
    dotEl = el('kaizo-agent-dot');
    revEl = el('kaizo-agent-rev');
    backendEl = el('kaizo-agent-backend');
    activeNameEl = el('kaizo-agent-active');
    activeKeyEl = el('kaizo-agent-key');
    inputEl = el('kaizo-agent-input');

    wireThumbs();

    document.querySelector('.kaizo-agent-picker')?.addEventListener('click', async (e) => {
      const card = e.target.closest('.kaizo-agent-card');
      if (!card) return;
      const key = card.getAttribute('data-robot');
      if (!key) return;

      try {
        const data = await fetch(api('/robots')).then((r) => r.json());
        const item = (data.robots || []).find((x) => x.key === key);
        const title = item?.title || key;
        const intro =
          item?.intro ||
          (english() ? 'Hi! I am your Kaizo demo agent.' : 'Szia! Kaizo demos ügynök vagyok.');
        halt();
        await startAgent(key, title, intro);
      } catch (err) {
        addMsg('ai', t('robotsFail'), t('errMeta'));
      }
    });

    el('kaizo-agent-send')?.addEventListener('click', sendTyped);
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendTyped();
    });
    el('kaizo-agent-halt')?.addEventListener('click', halt);

    (async () => {
      try {
        const h = await fetch(api('/health')).then((r) => r.json());
        if (revEl) revEl.textContent = ' · rev ' + (h.rev || '?');
        if (backendEl) backendEl.textContent = h.ok ? 'OK' : '?';
      } catch (e) {
        if (revEl) revEl.textContent = '';
        if (backendEl) backendEl.textContent = english() ? 'CORS / net' : 'CORS / háló';
      }
    })();

    setStatus('ok', 'IDLE');
    setLoopState('IDLE');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
