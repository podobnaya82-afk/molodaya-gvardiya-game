import { randomBytes } from "node:crypto";
import { checkOrigin, code, db, fail, method, reject, reply, requireActiveEvent, text, tokenHash, uuid } from "./_shared.js";

async function requireActiveSession(sessionId) {
  const sessions = await db("game_sessions", { select: "event_id", filters: { id: `eq.${sessionId}` } });
  if (!sessions.length) reject("Сеанс не найден.", 404);
  const events = await db("game_events", { select: "created_at", filters: { id: `eq.${sessions[0].event_id}` } });
  if (!events.length) reject("Мероприятие не найдено.", 404);
  requireActiveEvent(events[0].created_at);
}

export default async function handler(req, res) {
  try {
    method(req, ["POST"]);
    checkOrigin(req);
    if (req.body?.action === "start") {
      const sessions = await db("game_sessions", { select: "id,event_id", filters: { code: `eq.${code(req.body.code)}` } });
      if (!sessions.length) reject("Сеанс не найден.", 404);
      const events = await db("game_events", { select: "created_at", filters: { id: `eq.${sessions[0].event_id}` } });
      if (!events.length) reject("Мероприятие не найдено.", 404);
      requireActiveEvent(events[0].created_at);
      const token = randomBytes(32).toString("hex");
      const rows = await db("game_attempts", { select: "id", insert: {
        session_id: sessions[0].id,
        nickname: text(req.body.nickname, 28),
        token_hash: tokenHash(token)
      } });
      return reply(res, 201, { id: rows[0].id, token });
    }
    if (req.body?.action === "finish") {
      const id = uuid(req.body.id);
      const hash = tokenHash(req.body.token);
      const elapsed = req.body.seconds;
      const score = req.body.score;
      const missions = req.body.missions;
      if (!Number.isInteger(elapsed) || elapsed < 1 || elapsed > 14400 || !Number.isInteger(score) || score < 0 || score > 900 ||
          !Array.isArray(missions) || missions.length !== 6 || missions.some((m, index) =>
            m.index !== index + 1 || !Number.isInteger(m.attempts) || m.attempts < 0 || m.attempts > 10000 ||
            typeof m.hint !== "boolean" || !Number.isInteger(m.points) || m.points < 0 || m.points > 150)) {
        reject("Некорректные результаты игры.");
      }
      if (missions.reduce((sum, mission) => sum + mission.points, 0) !== score) reject("Итоговый счёт не совпадает с результатами миссий.");
      const rows = await db("game_attempts", { select: "id,session_id,started_at,finished_at", filters: { id: `eq.${id}`, token_hash: `eq.${hash}` } });
      if (!rows.length) reject("Прохождение не найдено.", 404);
      if (rows[0].finished_at) return reply(res, 200, { ok: true });
      await requireActiveSession(rows[0].session_id);
      if (Date.now() - new Date(rows[0].started_at).getTime() + 15000 < elapsed * 1000) reject("Время прохождения не совпадает с началом игры.");
      await db("game_attempts", { select: "id", filters: { id: `eq.${id}`, token_hash: `eq.${hash}`, finished_at: "is.null" }, update: {
        finished_at: new Date().toISOString(), elapsed_seconds: elapsed, score, missions
      } });
      return reply(res, 200, { ok: true });
    }
    reject("Неизвестное действие.");
  } catch (error) { return fail(res, error); }
}
