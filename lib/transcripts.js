import { listRecords } from "./storage.js";

export async function listConversationsBySession(sessionId, { limit = 500 } = {}) {
  if (!sessionId) return [];
  const rows = await listRecords("conversations", { limit });
  return rows
    .filter((c) => c.sessionId === sessionId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function getSessionTranscript(sessionId) {
  const turns = await listConversationsBySession(sessionId);
  const transcript = [];

  for (const turn of turns) {
    if (turn.userText) {
      transcript.push({
        role: "user",
        text: turn.userText,
        createdAt: turn.createdAt
      });
    }
    if (turn.aiText) {
      transcript.push({
        role: "assistant",
        text: turn.aiText,
        createdAt: turn.createdAt
      });
    }
  }

  return {
    sessionId,
    turnCount: turns.length,
    transcript
  };
}
