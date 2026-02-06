const VOICE_ID = "7B7mSWflzRSaO1yGeJH6"; // Ari
let currentRobot = null;
let mediaRecorder;
let audioChunks = [];
let isRunning = false;

const stateEl = document.getElementById("state");
const logEl = document.getElementById("log");

function log(msg) {
  console.log(msg);
  logEl.textContent += msg + "\n";
}

function setState(text, cls = "") {
  stateEl.textContent = text;
  stateEl.className = cls;
}

async function startRobot(robot) {
  if (isRunning) return;
  isRunning = true;
  currentRobot = robot;
  logEl.textContent = "";

  log(`▶ Robot indítva: ${robot}`);

  await speak(
    "Szia! Ari vagyok. Figyelek, mondd nyugodtan, miben segíthetek."
  );

  listenLoop();
}

async function listenLoop() {
  setState("LISTENING", "listening");
  log("🎤 Hallgatás indul");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

  mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });

    setState("THINKING", "thinking");
    log("🧠 Feldolgozás...");

    const text = await stt(audioBlob);
    if (!text || text.trim().length < 2) {
      log("⚠ Nem érthető válasz");
      return listenLoop();
    }

    log(`👤 Felhasználó: ${text}`);

    const answer = await think(text);
    log(`🤖 Ari: ${answer}`);

    await speak(answer);

    listenLoop();
  };

  mediaRecorder.start();
  setTimeout(() => mediaRecorder.stop(), 4000);
}

async function stt(blob) {
  const fd = new FormData();
  fd.append("audio", blob);

  const r = await fetch("/listen", {
    method: "POST",
    body: fd
  });

  const j = await r.json();
  return j.text;
}

async function think(text) {
  const r = await fetch("/think", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      robot: currentRobot
    })
  });

  const j = await r.json();
  return j.text;
}

async function speak(text) {
  setState("SPEAKING", "speaking");

  const r = await fetch("/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voiceId: VOICE_ID
    })
  });

  const audioData = await r.arrayBuffer();
  const audio = new Audio(URL.createObjectURL(new Blob([audioData])));
  await audio.play();

  return new Promise(res => {
    audio.onended = res;
  });
}
