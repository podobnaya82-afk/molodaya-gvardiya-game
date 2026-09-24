import { code, db, eventEndsAt, fail, method, reply } from "./_shared.js";

export default async function handler(req, res) {
  try {
    method(req, ["GET"]);
    const sessions = await db("game_sessions", { select: "id,title,game_events(title,created_at)", filters: { code: `eq.${code(req.query.code)}` } });
    if (!sessions.length) return reply(res, 404, { error: "Игровой сеанс не найден." });
    const expiresAt = eventEndsAt(sessions[0].game_events.created_at);
    return reply(res, 200, { title: sessions[0].title, event: sessions[0].game_events.title, expiresAt, ended: Date.now() >= expiresAt });
  } catch (error) { return fail(res, error); }
}
