import { ORG_BLITZ, ORG_SORT } from "./org-environment";

export type OrgPhase = "intro1" | "quiz" | "intro2" | "sort" | "intro3" | "blitz";
export type OrgMove = { id: number; answer: number | null; ms: number };
export type OrgBlitzMove = { id: number; answer: number; atMs: number };
export type OrgTranscript = { quiz: OrgMove[]; sort: OrgMove[]; blitz: OrgBlitzMove[] };
export type OrgFeedback = { phase: "quiz" | "sort" | "blitz"; index: number; itemId: number; correct: boolean; expected: number; delta: number; timedOut: boolean };
export type OrgSession = {
  attemptId: string; phase: OrgPhase; index: number; quizOrder: number[]; sortOrder: number[]; blitzOrder: number[];
  questionStarted: number; blitzStarted: number; score: number; streak: number; best: number;
  correct: number; answered: number; rounds: [number, number, number]; awaitNext: boolean;
  last: OrgFeedback | null; transcript: OrgTranscript;
};

export function createOrgSession(attemptId: string, quizOrder: number[], sortOrder: number[], blitzOrder: number[]): OrgSession {
  return { attemptId, phase: "intro1", index: 0, quizOrder, sortOrder, blitzOrder,
    questionStarted: 0, blitzStarted: 0, score: 0, streak: 0, best: 0, correct: 0, answered: 0,
    rounds: [0, 0, 0], awaitNext: false, last: null, transcript: { quiz: [], sort: [], blitz: [] } };
}

export function beginOrgRound(session: OrgSession, now: number): OrgSession {
  const phase = session.phase === "intro1" ? "quiz" : session.phase === "intro2" ? "sort" : session.phase === "intro3" ? "blitz" : null;
  if (!phase) return session;
  return { ...session, phase, index: 0, questionStarted: now,
    blitzStarted: phase === "blitz" ? now : session.blitzStarted, awaitNext: false, last: null };
}

export function advanceOrgQuestion(session: OrgSession, now: number): OrgSession {
  if (!session.awaitNext) return session;
  return { ...session, awaitNext: false, questionStarted: now, last: null };
}

export function answerOrgQuestion(session: OrgSession, answer: number | null, now: number): OrgSession {
  const { phase, index } = session;
  if (session.awaitNext || (phase !== "quiz" && phase !== "sort" && phase !== "blitz")) return session;
  const itemId = phase === "quiz" ? session.quizOrder[index]
    : phase === "sort" ? session.sortOrder[index] : session.blitzOrder[index];
  if (itemId === undefined) return session;
  const elapsed = Math.max(0, Math.floor(now - session.questionStarted));
  if (phase === "quiz" && (answer === null || elapsed >= 20000)) answer = null;
  if (phase === "blitz" && (now - session.blitzStarted >= 45000 || index >= 100)) return session;
  const expected = phase === "quiz" ? 0 : phase === "sort" ? ORG_SORT[itemId]?.[1] : Number(ORG_BLITZ[itemId]?.[1]);
  const correct = answer !== null && answer === expected;
  const streak = correct ? session.streak + 1 : 0;
  let delta = 0;
  let move: OrgMove | OrgBlitzMove;
  if (phase === "quiz") {
    const ms = answer === null ? 20000 : Math.min(19999, elapsed);
    if (correct) delta = Math.round((100 + 50 * (1 - ms / 20000)) * (streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1));
    move = { id: itemId, answer, ms };
  } else if (phase === "sort") {
    const ms = Math.min(3600000, elapsed);
    if (correct) delta = Math.round((50 + Math.max(0, 20 - ms / 250)) * (streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1));
    move = { id: itemId, answer, ms };
  } else {
    if (correct) delta = 30 + Math.min(30, session.transcript.blitz.length > 0
      ? consecutiveBlitzCorrect(session.transcript.blitz) * 5 : 0);
    const previous = session.transcript.blitz.at(-1)?.atMs ?? -1;
    move = { id: itemId, answer: answer ?? 0, atMs: Math.max(previous + 1, Math.floor(now - session.blitzStarted)) };
  }
  const roundIndex = phase === "quiz" ? 0 : phase === "sort" ? 1 : 2;
  const rounds: [number, number, number] = [...session.rounds]; rounds[roundIndex] += delta;
  const transcript = { ...session.transcript,
    [phase]: [...session.transcript[phase], move] } as OrgTranscript;
  const nextIndex = index + 1;
  const nextPhase: OrgPhase = phase === "quiz" && nextIndex === 10 ? "intro2"
    : phase === "sort" && nextIndex === 15 ? "intro3" : phase;
  return { ...session, phase: nextPhase, index: nextIndex, score: session.score + delta,
    streak, best: Math.max(session.best, streak), correct: session.correct + Number(correct),
    answered: session.answered + 1, rounds, transcript, awaitNext: nextPhase === phase,
    last: { phase, index, itemId, correct, expected, delta, timedOut: phase === "quiz" && answer === null } };
}

function consecutiveBlitzCorrect(moves: OrgBlitzMove[]): number {
  let count = 0;
  for (let index = moves.length - 1; index >= 0; index--) {
    const move = moves[index];
    if (move.answer !== Number(ORG_BLITZ[move.id]?.[1])) break;
    count++;
  }
  return count;
}

export function validOrgSession(value: unknown, attemptId: string, quizOrder: number[], sortOrder: number[], blitzOrder: number[]): value is OrgSession {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<OrgSession>;
  return state.attemptId === attemptId && ["intro1", "quiz", "intro2", "sort", "intro3", "blitz"].includes(state.phase || "")
    && Array.isArray(state.quizOrder) && JSON.stringify(state.quizOrder) === JSON.stringify(quizOrder)
    && Array.isArray(state.sortOrder) && JSON.stringify(state.sortOrder) === JSON.stringify(sortOrder)
    && Array.isArray(state.blitzOrder) && JSON.stringify(state.blitzOrder) === JSON.stringify(blitzOrder)
    && Number.isInteger(state.index) && Array.isArray(state.transcript?.quiz) && Array.isArray(state.transcript?.sort)
    && Array.isArray(state.transcript?.blitz) && typeof state.score === "number" && Array.isArray(state.rounds);
}
