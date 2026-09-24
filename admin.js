"use strict";

const loginSection = document.querySelector("#login-section");
const dashboard = document.querySelector("#dashboard");
const message = document.querySelector("#message");
const filter = document.querySelector("#filter");
const refreshButton = document.querySelector("#refresh");
const bestResultButton = document.querySelector("#best-result-button");
const bestResult = document.querySelector("#best-result");
let data = { events: [], sessions: [], attempts: [] };
let bestResultOpen = false;
let eventStatusTimer;
const eventDuration = 8 * 60 * 60 * 1000;

function eventEndsAt(event) {
  return new Date(event.created_at).getTime() + eventDuration;
}

function eventEnded(event) {
  return Date.now() >= eventEndsAt(event);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

async function api(body) {
  const response = await fetch("/api/admin", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "Ошибка запроса."), { status: response.status });
  return result;
}

function seconds(value) {
  if (value == null) return "—";
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

function currentAttempts() {
  const selected = filter.value;
  const sessionIds = new Set(data.sessions.filter((session) => selected === "all" || session.id === selected || (selected.startsWith("event:") && session.event_id === selected.slice(6))).map((session) => session.id));
  return data.attempts.filter((attempt) => sessionIds.has(attempt.session_id));
}

// Личный зачёт: меньшее время важнее; при равном времени выигрывает больший счёт.
function compareResults(a, b) {
  if (!a.finished_at) return b.finished_at ? 1 : new Date(a.started_at) - new Date(b.started_at);
  if (!b.finished_at) return -1;
  return a.elapsed_seconds - b.elapsed_seconds || b.score - a.score ||
    new Date(a.finished_at) - new Date(b.finished_at) || a.id.localeCompare(b.id);
}

function places(sorted) {
  const ranks = [];
  for (const [index, attempt] of sorted.entries()) {
    const previous = sorted[index - 1];
    ranks.push(!attempt.finished_at ? "" : previous && previous.finished_at &&
      previous.elapsed_seconds === attempt.elapsed_seconds && previous.score === attempt.score ? ranks[index - 1] : index + 1);
  }
  return ranks;
}

function selectedEventId() {
  if (filter.value.startsWith("event:")) return filter.value.slice(6);
  return data.sessions.find((session) => session.id === filter.value)?.event_id;
}

function renderBestResult() {
  const eventId = selectedEventId();
  bestResultButton.disabled = !eventId;
  document.querySelector("#best-result-hint").hidden = Boolean(eventId);
  bestResult.hidden = !bestResultOpen || !eventId;
  if (bestResult.hidden) return;

  const event = data.events.find((item) => item.id === eventId);
  const sessions = new Map(data.sessions.filter((session) => session.event_id === eventId).map((session) => [session.id, session]));
  const completed = data.attempts.filter((attempt) => attempt.finished_at && sessions.has(attempt.session_id)).sort(compareResults);
  const winner = completed[0];
  bestResult.innerHTML = `<h3>Лучший результат: ${escapeHtml(event?.title)}</h3>${winner ? completed.filter((attempt) => attempt.elapsed_seconds === winner.elapsed_seconds && attempt.score === winner.score).map((attempt) =>
    `<p><strong>${escapeHtml(attempt.nickname)}</strong> · ${seconds(attempt.elapsed_seconds)} · ${attempt.score} очков · ${escapeHtml(sessions.get(attempt.session_id).title)}</p>`).join("") : "<p>В этом мероприятии пока нет завершённых игр.</p>"}`;
}

function render() {
  const previous = filter.value || "all";
  filter.innerHTML = `<option value="all">Все мероприятия</option>${data.events.map((event) => `<option value="event:${escapeHtml(event.id)}">${escapeHtml(event.title)}${eventEnded(event) ? " — завершено" : ""}</option>${data.sessions.filter((session) => session.event_id === event.id).map((session) => `<option value="${escapeHtml(session.id)}">↳ ${escapeHtml(session.title)}${eventEnded(event) ? " — завершено" : ""}</option>`).join("")}`).join("")}`;
  filter.value = [...filter.options].some((option) => option.value === previous) ? previous : "all";
  const eventSelect = document.querySelector("#event-select");
  const previousEvent = eventSelect.value;
  eventSelect.innerHTML = data.events.map((event) => `<option value="${escapeHtml(event.id)}" ${eventEnded(event) ? "disabled" : ""}>${escapeHtml(event.title)}${eventEnded(event) ? " — завершено" : ""}</option>`).join("");
  eventSelect.value = data.events.find((event) => event.id === previousEvent && !eventEnded(event))?.id ||
    data.events.find((event) => !eventEnded(event))?.id || "";
  document.querySelector('#session-form button[type="submit"]').disabled = !eventSelect.value;
  renderResults();
  clearTimeout(eventStatusTimer);
  const nextEnd = Math.min(...data.events.filter((event) => !eventEnded(event)).map(eventEndsAt));
  if (Number.isFinite(nextEnd)) eventStatusTimer = setTimeout(render, Math.max(1, nextEnd - Date.now()));
}

function renderResults() {
  renderBestResult();
  const event = data.events.find((item) => item.id === selectedEventId());
  const eventStatus = document.querySelector("#event-status");
  eventStatus.hidden = !event;
  eventStatus.classList.toggle("ended", Boolean(event && eventEnded(event)));
  if (event) eventStatus.textContent = eventEnded(event) ? "Мероприятие завершено. Ссылки на игру больше не действуют." :
    `Мероприятие идёт до ${new Date(eventEndsAt(event)).toLocaleString("ru-RU")}.`;
  const attempts = currentAttempts();
  const completed = attempts.filter((attempt) => attempt.finished_at).sort(compareResults);
  const ranks = places(completed);
  const avg = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  document.querySelector("#summary").innerHTML = `
    <div><strong>${attempts.length}</strong>Начали игру</div><div><strong>${completed.length}</strong>Завершили</div>
    <div><strong>${avg(completed.map((attempt) => attempt.score)) ?? "—"}</strong>Средний балл</div>
    <div><strong>${seconds(avg(completed.map((attempt) => attempt.elapsed_seconds)))}</strong>Среднее время</div>`;
  const selected = filter.value;
  const visible = data.sessions.filter((session) => selected === "all" || session.id === selected || (selected.startsWith("event:") && session.event_id === selected.slice(6)));
  const links = document.querySelector("#session-list");
  links.replaceChildren();
  for (const session of visible) {
    const row = document.createElement("div");
    row.className = "session-link";
    const label = document.createElement("strong");
    const sessionEvent = data.events.find((item) => item.id === session.event_id);
    label.textContent = `${sessionEvent?.title || ""} / ${session.title}: `;
    if (sessionEvent && eventEnded(sessionEvent)) {
      row.append(label, document.createTextNode("Мероприятие завершено"));
      links.append(row);
      continue;
    }
    const link = document.createElement("a");
    link.href = new URL(`/?session=${encodeURIComponent(session.code)}`, location.origin).href;
    link.textContent = link.href;
    link.target = "_blank";
    link.rel = "noopener";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Копировать ссылку";
    button.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link.href); message.textContent = "Ссылка скопирована."; }
      catch { message.textContent = "Выделите и скопируйте ссылку вручную."; }
    });
    row.append(label, link, button);
    links.append(row);
  }
  document.querySelector("#results").innerHTML = completed.length ? `<table class="admin-table"><thead><tr><th>Место</th><th>Участник</th><th>Мероприятие / сеанс</th><th>Время</th><th>Очки</th><th>Завершено</th><th>Миссии (баллы / ошибки / подсказка)</th></tr></thead><tbody>${completed.map((attempt, index) => {
    const session = data.sessions.find((item) => item.id === attempt.session_id);
    const event = data.events.find((item) => item.id === session?.event_id);
    return `<tr><td><strong>${ranks[index]}</strong></td><td>${escapeHtml(attempt.nickname)}</td><td>${escapeHtml(event?.title)} / ${escapeHtml(session?.title)}</td><td>${seconds(attempt.elapsed_seconds)}</td><td>${attempt.score}</td><td>${new Date(attempt.finished_at).toLocaleString("ru-RU")}</td><td>${attempt.missions.map((m) => `${m.index}: ${m.points} / ${m.attempts} / ${m.hint ? "да" : "нет"}`).join("; ")}</td></tr>`;
  }).join("")}</tbody></table>` : "<p>Пока нет завершённых игр для выбранного фильтра.</p>";
}

async function load({ announce = false } = {}) {
  refreshButton.disabled = true;
  if (announce) message.textContent = "Обновляем статистику…";
  try {
    data = await api();
    loginSection.hidden = true;
    dashboard.hidden = false;
    render();
    message.textContent = announce ? `Статистика обновлена в ${new Date().toLocaleTimeString("ru-RU")}.` : "";
  } catch (error) {
    message.textContent = error.status === 401 ? "Войдите как организатор." : error.message;
    if (error.status === 401) { loginSection.hidden = false; dashboard.hidden = true; }
  } finally {
    refreshButton.disabled = false;
  }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api({ action: "login", password: document.querySelector("#password").value });
    document.querySelector("#password").value = "";
    await load();
  } catch (error) { message.textContent = error.message; }
});

for (const [formId, action] of [["#event-form", "event"], ["#session-form", "session"]]) {
  document.querySelector(formId).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api({ action, ...Object.fromEntries(new FormData(form)) });
      form.reset();
      await load();
      message.textContent = action === "event" ? "Мероприятие создано." : "Сеанс создан. Скопируйте его ссылку.";
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

filter.addEventListener("change", () => { bestResultOpen = false; renderResults(); });
bestResultButton.addEventListener("click", () => { bestResultOpen = !bestResultOpen; renderBestResult(); });
refreshButton.addEventListener("click", () => load({ announce: true }));
document.querySelector("#export").addEventListener("click", () => {
  const rows = [["Место", "Мероприятие", "Сеанс", "Псевдоним", "Начало", "Завершение", "Время (сек)", "Очки", "Миссии JSON"]];
  const sorted = currentAttempts().sort(compareResults);
  const ranks = places(sorted);
  for (const [index, attempt] of sorted.entries()) {
    const session = data.sessions.find((item) => item.id === attempt.session_id);
    const event = data.events.find((item) => item.id === session?.event_id);
    rows.push([ranks[index], event?.title, session?.title, attempt.nickname, attempt.started_at, attempt.finished_at, attempt.elapsed_seconds, attempt.score, JSON.stringify(attempt.missions)]);
  }
  const csv = "\uFEFF" + rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "statistika-igry.csv"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

load();
