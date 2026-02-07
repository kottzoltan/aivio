// telephony/calls.js
// Egyszerű in-memory call store (Cloud Run újraindulásnál törlődik - demóra tökéletes)

export const CALLS = new Map();

/**
 * @param {string} callId
 * @param {string} robot
 */
export function createCallSession(callId, robot = "support_inbound") {
  const session = {
    callId,
    robot,
    history: [],
    createdAt: Date.now(),
    lastSeenAt: Date.now()
  };

  CALLS.set(callId, session);
  return session;
}

export function getCallSession(callId) {
  const s = CALLS.get(callId);
  if (!s) return null;
  s.lastSeenAt = Date.now();
  return s;
}

export function closeCallSession(callId) {
  return CALLS.delete(callId);
}

// opcionális: takarítás
export function sweepOldCalls(maxAgeMs = 30 * 60 * 1000) {
  const now = Date.now();
  for (const [callId, s] of CALLS.entries()) {
    if (now - (s.lastSeenAt || s.createdAt) > maxAgeMs) {
      CALLS.delete(callId);
    }
  }
}
