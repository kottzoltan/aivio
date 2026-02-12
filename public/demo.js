// ==============================
// AIVIO – DEMO.JS (STABIL LOOP + CRM)
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

  recognition.onresult = async (event) => {
    const text = event.results[0][0].transcript.trim();
    isListening = false;

    if (!text) {
      safeRestartListening();
      return;
    }

    await handleUserText(text);
  };

  recognition.onerror = () => {
    isListening = false;
    safeRestartListening();
  };

  recognition.onend = () => {
    isListening = false;
    safeRestartListening();
  };
}

// ------------------------------
// HALLGATÁS INDÍTÁS
// ------------------------------
function listenLoop() {
  if (!recognition || isListening) return;

  try {
    isListening = true;
    recognition.start();
  } catch {
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

    // ==============================
    // 🎯 CRM MENTÉS (CSAK SALES)
    // ==============================
    if (currentRobot === "outbound_sales") {
      try {
        fetch(`${backendBase}/crm/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            robot: "outbound_sales",
            name: "Web demo érdeklődő",
            note: text
          })
        });
      } catch (e) {
        console.warn("CRM save failed:", e);
      }
    }

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
  currentRobot = robotKey;
  setStatus("LISTENING");
  listenLoop();
}

// ------------------------------
// UI STATE
// ------------------------------
function setStatus(state) {
  const el = document.getElementById("state");
  if (el) el.innerText = state;
}

// ------------------------------
// INIT
// ------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initSpeechRecognition();

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      try {
        recognition.abort();
      } catch {}
      isListening = false;
    }
  });
});
