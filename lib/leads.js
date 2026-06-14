import {
  appendRecord,
  findRecord,
  listRecords,
  readObject,
  upsertRecord,
  updateRecord
} from "./storage.js";

export const LEAD_STAGES = [
  { id: "new", name: "Új", sequence: 1, probability: 10 },
  { id: "contacted", name: "Kapcsolatfelvéve", sequence: 2, probability: 25 },
  { id: "qualified", name: "Minősített", sequence: 3, probability: 50 },
  { id: "meeting", name: "Időpont egyeztetve", sequence: 4, probability: 70 },
  { id: "won", name: "Megnyert", sequence: 5, probability: 100 },
  { id: "lost", name: "Elvesztett", sequence: 6, probability: 0 }
];

export function getStageById(stageId) {
  return LEAD_STAGES.find((s) => s.id === stageId) || LEAD_STAGES[0];
}

export function formatLead(lead) {
  const stage = getStageById(lead.stage || "new");
  return {
    id: lead.id,
    name: lead.name || "Ismeretlen",
    email: lead.email || null,
    phone: lead.phone || null,
    company: lead.company || null,
    robot: lead.robot || null,
    sessionId: lead.sessionId || null,
    stage: stage.id,
    stageName: stage.name,
    probability: stage.probability,
    expectedRevenue: Number(lead.expectedRevenue || 0),
    notes: lead.notes || [],
    appointmentAt: lead.appointmentAt || null,
    surveyScores: lead.surveyScores || [],
    source: lead.source || "conversation",
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt
  };
}

export async function listLeads({ limit = 200, includeSurveys = false } = {}) {
  const rows = await listRecords("leads", { limit });
  const filtered = includeSurveys
    ? rows
    : rows.filter((l) => l.robot !== "customer_satisfaction");
  return filtered.map(formatLead);
}

export async function getLead(id) {
  const lead = await readObject("leads", id);
  return lead ? formatLead(lead) : null;
}

export async function findLeadBySession(sessionId) {
  if (!sessionId) return null;
  const row = await findRecord("leads", (l) => l.sessionId === sessionId);
  return row ? formatLead(row) : null;
}

export async function createLead(data) {
  const id = data.id || `${Date.now()}`;
  const stage = getStageById(data.stage || "new");
  const lead = await upsertRecord("leads", id, {
    name: data.name || "Ismeretlen",
    email: data.email || null,
    phone: data.phone || null,
    company: data.company || null,
    robot: data.robot || null,
    sessionId: data.sessionId || null,
    stage: stage.id,
    expectedRevenue: Number(data.expectedRevenue || 0),
    notes: data.notes || [],
    appointmentAt: data.appointmentAt || null,
    surveyScores: data.surveyScores || [],
    source: data.source || "manual",
    conversationSummary: data.conversationSummary || ""
  });
  return formatLead(lead);
}

export async function updateLead(id, patch) {
  const existing = await readObject("leads", id);
  if (!existing) return null;
  const updated = await updateRecord("leads", id, patch);
  return updated ? formatLead(updated) : null;
}

export async function addLeadNote(id, message) {
  const existing = await readObject("leads", id);
  if (!existing) return null;
  const notes = [...(existing.notes || []), { text: String(message), createdAt: new Date().toISOString() }];
  return updateLead(id, { notes });
}

export async function upsertLeadFromConversation({
  sessionId,
  robot,
  extracted,
  userText,
  aiText
}) {
  if (robot === "customer_satisfaction") return null;

  let lead = await findLeadBySession(sessionId);

  if (!lead && (extracted.email || extracted.phone)) {
    const rows = await listRecords("leads", { limit: 500 });
    const match = rows.find((l) =>
      (extracted.email && l.email === extracted.email) ||
      (extracted.phone && l.phone === extracted.phone)
    );
    if (match) lead = formatLead(match);
  }

  const note = { text: `Ügyfél: ${userText}\nAri: ${aiText}`, createdAt: new Date().toISOString() };
  const patch = {
    robot,
    sessionId,
    source: "conversation"
  };

  if (extracted.name) patch.name = extracted.name;
  if (extracted.email) patch.email = extracted.email;
  if (extracted.phone) patch.phone = extracted.phone;
  if (extracted.company) patch.company = extracted.company;
  if (extracted.appointmentAt) {
    patch.appointmentAt = extracted.appointmentAt;
    patch.stage = "meeting";
  }
  if (extracted.surveyScores?.length) patch.surveyScores = extracted.surveyScores;

  if (!lead) {
    const created = await createLead({
      id: sessionId || `${Date.now()}`,
      name: extracted.name || "Ismeretlen",
      email: extracted.email,
      phone: extracted.phone,
      company: extracted.company,
      robot,
      sessionId,
      stage: patch.stage || "new",
      appointmentAt: patch.appointmentAt,
      surveyScores: patch.surveyScores,
      notes: [note],
      source: "conversation"
    });
    return created;
  }

  const notes = [...(lead.notes || []), note].slice(-50);
  const updated = await updateLead(lead.id, { ...patch, notes });
  return updated;
}

export async function getPipelineStats() {
  const leads = await listLeads({ limit: 2000 });
  const pipeline = LEAD_STAGES.map((stage) => {
    const bucket = leads.filter((l) => l.stage === stage.id);
    const sumExpectedRevenue = bucket.reduce((a, l) => a + Number(l.expectedRevenue || 0), 0);
    const sumWeightedRevenue = bucket.reduce(
      (a, l) => a + Number(l.expectedRevenue || 0) * (stage.probability / 100),
      0
    );
    return {
      stageId: stage.id,
      stageName: stage.name,
      count: bucket.length,
      sumExpectedRevenue,
      sumWeightedRevenue
    };
  });

  const totals = pipeline.reduce(
    (acc, s) => {
      acc.leads += s.count;
      acc.expected += s.sumExpectedRevenue;
      acc.weighted += s.sumWeightedRevenue;
      return acc;
    },
    { leads: 0, expected: 0, weighted: 0 }
  );

  return { pipeline, totals };
}

export async function listAppointments({ limit = 200 } = {}) {
  return listRecords("appointments", { limit });
}

export async function createAppointment(data) {
  return appendRecord("appointments", {
    name: data.name,
    start: data.start,
    stop: data.stop,
    leadId: data.leadId || null,
    robot: data.robot || null,
    createdAt: new Date().toISOString()
  });
}

export async function logConversation(entry) {
  return appendRecord("conversations", entry);
}

export async function logCmsSave(entry) {
  return appendRecord("cms_save_log", entry);
}

export async function listCmsSaveLog(limit = 20) {
  return listRecords("cms_save_log", { limit });
}
