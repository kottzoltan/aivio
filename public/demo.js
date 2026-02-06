// ==============================
// AIVIO – DEMO.JS (STABIL LOOP)
// ==============================

// ------------------------------
// GLOBÁLIS ÁLLAPOT
// ------------------------------
let recognition;
let isListening = false;
let currentRobot = null;
let voiceId = "7B7mSWflzRSaO1yGeJH6"; // Ari
let backendBase = ""; // same origin

// ------------------------------
// INIT – SPEECH RECOGNITION
// ------------------------------
function initSpeechRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert("A böngésző nem támogatja a SpeechRecognition-t (Chrome ajánlott)");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "hu-HU";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    console.log("🎧 recognition started");
  };

  recognition.onresult = async (event) => {
    const text = event.results[0][0].transcript.trim();
    console.log("🗣️ User said:", text);

    isListening = false;

    if (!text) {
      safeRestartListening();
      return;
    }

    await handleUserText(text);
  };

  recognition.onerror = (e) => {
    console.warn("🎧 recognition error:", e.error);
    isListening = false;
    safeRestartListening();
  };

  recognition.onend = () => {
    console.log("🎧 recognition ended");
    isListening = false;
    safeRestartListening();
  };
}

// ------------------------------
// BIZTONSÁGOS HALLGATÁS INDÍTÁS
// ------------------------------
function listenLoop() {
  if (!recognition) return;

  if (isListening) {
    console.log("🎧 listenLoop: már fut, skip");
    return;
  }

  try {
    isListening = true;
    console.log("🎧 listenLoop: start");
    recognition.start();
  } catch (err) {
    console.warn("🎧 listenLoop exception:", err);
    isListening = false;
  }
}

function safeRestartListening() {
  setTimeout(() => {
    listenLoop();
  }, 400);
}

// ------------------------------
// USER TEXT → THINK → SPEAK
// ------------------------------
async function handleUserText(text) {
  try {
    setStatus("THINKING");

    const thinkRes = await fetch(`${backendBase}/think`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        robot: currentRobot
      })
    });

    const thinkData = await thinkRes.json();
    if (!thinkData.text) throw new Error("Empty think response");

    await speak(thinkData.text);
  } catch (err) {
    console.error("❌ handleUserText error:", err);
    safeRestartListening();
  }
}

// ------------------------------
// TTS – ELEVENLABS
// ------------------------------
async function speak(text) {
  try {
    setStatus("SPEAKING");

    const res = await fetch(`${backendBase}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceId
      })
    });

    const audioBlob = await res.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    const audio = new Audio(audioUrl);
    audio.onended = () => {
      console.log("🔊 speech ended");
      setStatus("LISTENING");
      safeRestartListening();
    };

    audio.play();
  } catch (err) {
    console.error("❌ speak error:", err);
    safeRestartListening();
  }
}

// ------------------------------
// ROBOT VÁLTÁS
// ------------------------------
function startRobot(robotKey) {
  console.log("🤖 robot selected:", robotKey);
  currentRobot = robotKey;

  setStatus("LISTENING");
  listenLoop();
}

// ------------------------------
// UI STATUS (OPCIONÁLIS)
// ------------------------------
function setStatus(state) {
  console.log("📡 STATE:", state);
  const el = document.getElementById("state");
  if (el) el.innerText = state;
}

// ------------------------------
// INIT
// ------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initSpeechRecognition();

  // fallback: ESC mindent leállít
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      try {
        recognition.abort();
      } catch {}
      isListening = false;
      console.log("⛔ ESC – stop");
    }
  });
});
