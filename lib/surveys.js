import { listRecords, readObject, upsertRecord } from "./storage.js";

const HU_NUMBERS = {
  egy: 1,
  kettő: 2,
  ketto: 2,
  három: 3,
  harom: 3,
  négy: 4,
  negy: 4,
  öt: 5,
  ot: 5
};

export function extractScoreFromText(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  const direct = t.match(/^(?:igen[,!]?\s*)?([1-5])(?:\s*(?:pont|pontot|\/\s*5|az\s+öt|az\s+négy|az\s+három|az\s+kettő|az\s+egy))?\.?$/i);
  if (direct) return Number(direct[1]);

  const word = t.toLowerCase().match(/\b(egy|kettő|ketto|három|harom|négy|negy|öt|ot)\b/);
  if (word) return HU_NUMBERS[word[1]] ?? null;

  const embedded = t.match(/\b([1-5])\b/);
  return embedded ? Number(embedded[1]) : null;
}

function avg(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function isSurveyClosing(aiText) {
  const t = String(aiText || "").toLowerCase();
  return /köszön|viszontlát|szép napot|kellemes napot/.test(t);
}

export function formatSurvey(survey) {
  const scores = survey.scores || [];
  return {
    id: survey.id,
    sessionId: survey.sessionId,
    robot: survey.robot,
    title: survey.title || "Elégedettségmérés",
    scores,
    avgScore: survey.avgScore ?? avg(scores),
    responseCount: scores.length,
    status: survey.status || "in_progress",
    transcript: survey.transcript || [],
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    completedAt: survey.completedAt || null
  };
}

function historyToTranscript(history = []) {
  return history
    .filter((m) => m?.content)
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      text: String(m.content),
      score: m.role === "user" ? extractScoreFromText(m.content) : null,
      createdAt: null
    }));
}

export async function upsertSurveyFromTurn({
  sessionId,
  robot,
  history = [],
  userText,
  aiText
}) {
  if (!sessionId || robot !== "customer_satisfaction") return null;

  const now = new Date().toISOString();
  const score = extractScoreFromText(userText);
  const existing = await readObject("surveys", sessionId);

  const userTurn = {
    role: "user",
    text: userText,
    score,
    createdAt: now
  };
  const aiTurn = {
    role: "assistant",
    text: aiText,
    createdAt: now
  };

  let survey = existing;

  if (!survey) {
    const seed = historyToTranscript(history);
    const transcript = [...seed, userTurn, aiTurn];
    const scores = transcript
      .filter((t) => t.role === "user" && t.score != null)
      .map((t) => t.score);

    survey = {
      id: sessionId,
      sessionId,
      robot,
      title: "Elégedettségmérés",
      transcript,
      scores,
      avgScore: avg(scores),
      responseCount: scores.length,
      status: isSurveyClosing(aiText) ? "completed" : "in_progress",
      createdAt: now,
      updatedAt: now,
      completedAt: isSurveyClosing(aiText) ? now : null
    };
  } else {
    const transcript = [...(survey.transcript || []), userTurn, aiTurn];
    const scores = transcript
      .filter((t) => t.role === "user" && t.score != null)
      .map((t) => t.score);
    const completed = isSurveyClosing(aiText) || survey.status === "completed";

    survey = {
      ...survey,
      transcript,
      scores,
      avgScore: avg(scores),
      responseCount: scores.length,
      status: completed ? "completed" : "in_progress",
      updatedAt: now,
      completedAt: completed ? (survey.completedAt || now) : null
    };
  }

  const saved = await upsertRecord("surveys", sessionId, survey);
  return formatSurvey(saved);
}

export async function listSurveys({ limit = 200 } = {}) {
  const rows = await listRecords("surveys", { limit });
  return rows.map(formatSurvey);
}

export async function getSurvey(sessionId) {
  const survey = await readObject("surveys", sessionId);
  return survey ? formatSurvey(survey) : null;
}

export async function getSurveyStats() {
  const surveys = await listSurveys({ limit: 2000 });
  const allScores = surveys.flatMap((s) => s.scores || []);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  allScores.forEach((n) => {
    if (distribution[n] != null) distribution[n] += 1;
  });

  const maxLen = surveys.reduce((m, s) => Math.max(m, (s.scores || []).length), 0);
  const questionAverages = [];
  for (let i = 0; i < maxLen; i++) {
    const bucket = surveys
      .map((s) => s.scores?.[i])
      .filter((n) => typeof n === "number");
    questionAverages.push({
      questionIndex: i + 1,
      label: `${i + 1}. kérdés`,
      avg: avg(bucket),
      count: bucket.length
    });
  }

  return {
    totalSurveys: surveys.length,
    completedSurveys: surveys.filter((s) => s.status === "completed").length,
    totalResponses: allScores.length,
    avgOverallScore: avg(allScores),
    scoreDistribution: distribution,
    questionAverages,
    recent: surveys.slice(0, 10)
  };
}
