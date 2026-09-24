import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const cookieName = "mg_admin";
const sessionDuration = 12 * 60 * 60;
const eventDuration = 8 * 60 * 60 * 1000;

export function eventEndsAt(createdAt) {
  return new Date(createdAt).getTime() + eventDuration;
}

export function requireActiveEvent(createdAt) {
  if (Date.now() >= eventEndsAt(createdAt)) reject("Мероприятие завершено.", 410);
}

export function reply(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(data);
}

export function fail(res, error) {
  console.error("Game API:", error);
  return reply(res, error.status || 500, { error: error.publicMessage || "Ошибка сервера. Попробуйте позже." });
}

export function reject(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  throw error;
}

export function method(req, allowed) {
  if (!allowed.includes(req.method)) reject("Метод не поддерживается.", 405);
}

export function checkOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) reject("Недопустимый источник запроса.", 403);
    } catch { reject("Недопустимый источник запроса.", 403); }
  }
}

export function text(value, length = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > length) {
    reject(`Введите текст длиной до ${length} символов.`);
  }
  return value.trim();
}

export function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) reject("Неверный идентификатор.");
  return value;
}

export function code(value) {
  if (typeof value !== "string" || !/^[A-Z0-9]{8}$/.test(value.toUpperCase())) reject("Неверный код сеанса.");
  return value.toUpperCase();
}

export function tokenHash(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) reject("Неверный ключ прохождения.");
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && timingSafeEqual(left, right);
}

function secret() {
  if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET.length < 32) {
    reject("Панель организатора ещё не настроена.", 503);
  }
  return process.env.ADMIN_SESSION_SECRET;
}

function signature(payload) {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function login(res, password) {
  secret();
  if (typeof password !== "string" || !safeEqual(createHash("sha256").update(password).digest("hex"), createHash("sha256").update(process.env.ADMIN_PASSWORD).digest("hex"))) {
    reject("Неверный пароль.", 401);
  }
  const payload = `${Math.floor(Date.now() / 1000) + sessionDuration}.${randomBytes(8).toString("hex")}`;
  res.setHeader("Set-Cookie", `${cookieName}=${payload}.${signature(payload)}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${sessionDuration}`);
}

export function logout(res) {
  res.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0`);
}

export function requireAdmin(req) {
  const raw = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const match = raw?.match(/^(\d+)\.([a-f0-9]{16})\.([a-f0-9]{64})$/);
  if (!match || Number(match[1]) < Date.now() / 1000 || !safeEqual(match[3], signature(`${match[1]}.${match[2]}`))) {
    reject("Войдите как организатор.", 401);
  }
}

export async function db(table, { select = "*", filters = {}, insert, update, order, range } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) reject("База данных ещё не подключена.", 503);
  const path = new URL(`/rest/v1/${table}`, url);
  path.searchParams.set("select", select);
  for (const [column, filter] of Object.entries(filters)) path.searchParams.set(column, filter);
  if (order) path.searchParams.set("order", order);
  const response = await fetch(path, {
    method: insert ? "POST" : update ? "PATCH" : "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(range ? { Range: `${range[0]}-${range[1]}`, "Range-Unit": "items" } : {})
    },
    ...(insert || update ? { body: JSON.stringify(insert || update) } : {})
  });
  if (!response.ok) {
    console.error("Supabase error", response.status, await response.text());
    reject("Не удалось получить данные. Проверьте настройку базы.", 503);
  }
  return response.json();
}

export async function allRows(table, options = {}) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = await db(table, { ...options, range: [offset, offset + 999] });
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}
