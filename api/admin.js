import { randomBytes } from "node:crypto";
import { allRows, checkOrigin, db, fail, login, logout, method, reject, reply, requireActiveEvent, requireAdmin, text, uuid } from "./_shared.js";

export default async function handler(req, res) {
  try {
    method(req, ["GET", "POST"]);
    if (req.method === "POST") {
      checkOrigin(req);
      if (req.body?.action === "login") {
        login(res, req.body.password);
        return reply(res, 200, { ok: true });
      }
      requireAdmin(req);
      if (req.body?.action === "logout") {
        logout(res);
        return reply(res, 200, { ok: true });
      }
      if (req.body?.action === "event") {
        const rows = await db("game_events", { insert: { title: text(req.body.title) } });
        return reply(res, 201, rows[0]);
      }
      if (req.body?.action === "session") {
        const events = await db("game_events", { select: "id,created_at", filters: { id: `eq.${uuid(req.body.eventId)}` } });
        if (!events.length) reject("Мероприятие не найдено.", 404);
        requireActiveEvent(events[0].created_at);
        // Нечитаемые символы исключены, чтобы код было удобно набирать вручную.
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = randomBytes(8);
        const code = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
        const rows = await db("game_sessions", { insert: { event_id: events[0].id, title: text(req.body.title), code } });
        return reply(res, 201, rows[0]);
      }
      reject("Неизвестное действие.");
    }
    requireAdmin(req);
    const [events, sessions, attempts] = await Promise.all([
      allRows("game_events", { select: "id,title,created_at", order: "created_at.desc" }),
      allRows("game_sessions", { select: "id,event_id,title,code,created_at", order: "created_at.desc" }),
      allRows("game_attempts", { select: "id,session_id,nickname,started_at,finished_at,elapsed_seconds,score,missions", order: "started_at.desc" })
    ]);
    return reply(res, 200, { events, sessions, attempts });
  } catch (error) { return fail(res, error); }
}
