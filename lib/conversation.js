import { upsertLeadFromConversation, createAppointment } from "./leads.js";

export function extractContact(text) {
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phone = text.match(/(?:\+36|06)?[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}|\+\d[\d\s\-]{7,}/);
  return {
    email: email ? email[0] : null,
    phone: phone ? phone[0].replace(/\s+/g, " ").trim() : null
  };
}

export function extractName(text) {
  const patterns = [
    /(?:a nevem|nevem|hívnak|vagyok)\s+([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+)?)/i,
    /^([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+)?)\s+vagyok/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export function extractCompany(text) {
  const patterns = [
    /(?:cég(?:em|ünk)?|vállalat(?:om|unk)?|company)\s*[:\-]?\s*([A-Za-zÀ-ž0-9 .&\-]{2,80})/i,
    /(?:a\s+)?([A-ZÁÉÍÓÖŐÚÜŰ][A-Za-záéíóöőúüű0-9 .&\-]{2,40})\s+(?:cégénél|vállalatánál|nél dolgozom)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export function parseAppointmentDate(text) {
  const isoLike = text.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2})[:.](\d{2}))?\b/);
  if (isoLike) {
    const dt = new Date(
      Number(isoLike[1]),
      Number(isoLike[2]) - 1,
      Number(isoLike[3]),
      Number(isoLike[4] || 10),
      Number(isoLike[5] || 0)
    );
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }

  const huLike = text.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/]?(20\d{2})?(?:\s*(?:kor|ra|re)?\s*(\d{1,2})[:.](\d{2}))?\b/i);
  if (huLike) {
    const year = Number(huLike[3] || new Date().getFullYear());
    const month = Number(huLike[2]);
    const day = Number(huLike[1]);
    const dt = new Date(year, month - 1, day, Number(huLike[4] || 10), Number(huLike[5] || 0));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }

  const relative = text.match(/\b(holnap|holnapután|jövő héten|hétfőn|kedden|szerdán|csütörtökön|pénteken)\b/i);
  if (relative) {
    const d = new Date();
    const word = relative[1].toLowerCase();
    if (word === "holnap") d.setDate(d.getDate() + 1);
    else if (word === "holnapután") d.setDate(d.getDate() + 2);
    else if (word === "jövő héten") d.setDate(d.getDate() + 7);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  }

  return null;
}

export function extractSurveyAnswers(text) {
  const answers = [];
  const regex = /(?:\b([1-5])\b\s*(?:\/\s*5)?|([1-5])\s*(?:pont|score))/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    answers.push(Number(m[1] || m[2]));
  }
  return answers;
}

export function extractFromHistory(history = [], latestUserText = "") {
  const fullText = [
    ...history.map((m) => m.content || ""),
    latestUserText
  ].join("\n");

  const contact = extractContact(fullText);
  return {
    name: extractName(fullText),
    email: contact.email,
    phone: contact.phone,
    company: extractCompany(fullText),
    appointmentAt: parseAppointmentDate(fullText),
    surveyScores: extractSurveyAnswers(fullText)
  };
}

export async function processConversationTurn({
  sessionId,
  robot,
  history,
  userText,
  aiText
}) {
  const extracted = extractFromHistory(history, userText);

  const lead = await upsertLeadFromConversation({
    sessionId,
    robot,
    extracted,
    userText,
    aiText
  });

  if (extracted.appointmentAt && robot !== "customer_satisfaction") {
    const start = new Date(extracted.appointmentAt);
    const stop = new Date(start.getTime() + 60 * 60 * 1000);
    await createAppointment({
      name: `${robot} – ${lead.name}`,
      start: start.toISOString(),
      stop: stop.toISOString(),
      leadId: lead.id,
      robot
    });
  }

  return { lead, extracted };
}
