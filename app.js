"use strict";

const app = document.querySelector("#app");
const topbar = document.querySelector("#topbar");
const progressTrack = document.querySelector("#progress-track");
const progressFill = document.querySelector("#progress-fill");
const scoreNode = document.querySelector("#score");
const timerNode = document.querySelector("#timer");
const missionCount = document.querySelector("#mission-count");
const sessionCode = new URLSearchParams(location.search).get("session")?.trim().toUpperCase() || "";
let sessionInfo = null;
let sessionError = "";

function renderEventEnded() {
  stopTimer();
  topbar.hidden = true;
  progressTrack.hidden = true;
  app.innerHTML = `<section class="screen"><article class="document clue-reveal"><div>
    <p class="eyebrow">${escapeHtml(sessionInfo?.event || "Игровой сеанс")}</p>
    <h1 class="mission-title">Мероприятие завершено</h1>
    <p class="fact-note">Ссылка действовала 8 часов с момента создания мероприятия. Новые прохождения и результаты больше не принимаются.</p>
  </div></article></section>`;
}

let audioContext;

function playTone(frequency, duration, type = "sine", volume = 0.045, delay = 0) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  } catch {
    // Звук необязателен: игра продолжает работать без поддержки Web Audio.
  }
}

function playSuccessSound() {
  playTone(523.25, 0.16, "sine", 0.05);
  playTone(659.25, 0.22, "sine", 0.045, 0.12);
  playTone(783.99, 0.28, "sine", 0.04, 0.24);
}

function playErrorSound() {
  playTone(180, 0.18, "triangle", 0.045);
  playTone(130, 0.25, "triangle", 0.035, 0.12);
}

function playFinalSound() {
  playTone(392, 0.18, "sine", 0.05);
  playTone(523.25, 0.22, "sine", 0.05, 0.12);
  playTone(659.25, 0.35, "sine", 0.05, 0.25);
}

const state = {
  participant: "",
  missionIndex: 0,
  score: 0,
  clues: [],
  attempts: 0,
  hintUsed: false,
  secondsLeft: 0,
  timerId: null,
  startedAt: null,
  finishedAt: null,
  resultSaved: false,
  remoteAttempt: null,
  missions: [],
  resultUploaded: false
};

const resultsStorageKey = "molodaya-gvardiya-results-v1";

const timelineEvents = [
  { id: "occupation", text: "Оккупация Краснодона", date: "20 июля 1942" },
  { id: "union", text: "Объединение подпольных групп под названием «Молодая гвардия»", date: "конец сентября 1942" },
  { id: "flags", text: "Красные флаги появились в городе к годовщине Октябрьской революции", date: "7 ноября 1942" },
  { id: "fire", text: "Пожар на бирже труда", date: "ночь с 5 на 6 декабря 1942" },
  { id: "arrests", text: "Массовые аресты участников подполья", date: "январь 1943" },
  { id: "liberation", text: "Освобождение Краснодона", date: "14 февраля 1943" }
];

const missionData = [
  {
    kicker: "Архив 01 / Хронология",
    title: "Восстановите ход событий",
    brief: "Нажимайте карточки от самого раннего события к самому позднему. Выбранный порядок отмечается номером.",
    time: 110,
    clue: "КР",
    hint: "Начните с оккупации города. Освобождение Краснодона завершает эту последовательность.",
    fact: "Подпольные группы Краснодона объединились осенью 1942 года. Хронология помогает не смешивать реальные события с позднейшими интерпретациями.",
    render: renderTimeline,
    check: checkTimeline
  },
  {
    kicker: "Архив 02 / Шифр",
    title: "Прочитайте ключевое слово",
    brief: "В шифре каждая исходная буква была заменена следующей буквой русского алфавита. Чтобы прочитать слово, сделайте обратное: для каждой зашифрованной буквы найдите предыдущую.",
    time: 75,
    clue: "А",
    hint: "Первая буква «М» превращается в «Л». В слове восемь букв.",
    fact: "Листовки были одним из главных способов распространения сообщений подполья. В игре используется условный шифр, а не подлинная система связи организации.",
    render: renderCipher,
    check: checkCipher
  },
  {
    kicker: "Архив 03 / Маршрут",
    title: "Выберите безопасный путь",
    brief: "Это игровая реконструкция. По донесению наблюдателя площадь и станция контролируются. Выберите путь без отмеченных постов.",
    time: 65,
    clue: "С",
    hint: "Безопасность важнее длины маршрута. Ищите путь, где нет ни площади, ни станции.",
    fact: "Участникам подполья приходилось действовать в условиях оккупации и постоянной опасности. Показанная схема не является картой конкретной операции.",
    render: renderRoute,
    check: checkRoute
  },
  {
    kicker: "Архив 04 / Участники",
    title: "Соедините имена и факты",
    brief: "Выберите для каждого участника соответствующий биографический факт. Все четыре строки должны быть заполнены.",
    time: 120,
    clue: "НО",
    hint: "Туркенич имел фронтовой опыт, а Шевцова прошла подготовку радистки.",
    fact: "За общим названием организации стоят судьбы конкретных юношей и девушек. Биографические сведения необходимо сверять по музейным и архивным источникам.",
    render: renderMatching,
    check: checkMatching
  },
  {
    kicker: "Архив 05 / Источники",
    title: "Отделите факт от образа",
    brief: "Определите статус каждого утверждения: установленный факт, художественный образ или сведения, которые необходимо дополнительно проверить.",
    time: 125,
    clue: "Д",
    hint: "Дословная реплика персонажа без документа обычно относится к художественному образу. Расхождение источников требует проверки.",
    fact: "Роман А. А. Фадеева сыграл огромную роль в сохранении памяти, но художественное произведение не заменяет архивный документ.",
    render: renderSources,
    check: checkSources
  },
  {
    kicker: "Архив 06 / Внимание",
    title: "Запомните карточку связного",
    brief: "Изучите учебную карточку. Через 15 секунд она закроется, после чего нужно ответить на четыре вопроса.",
    time: 80,
    clue: "ОН",
    hint: "Карточку можно открыть повторно, но это уменьшит награду за миссию.",
    fact: "Это вымышленная учебная карточка для проверки внимания. Её имена, время и маршрут не описывают реальную операцию «Молодой гвардии».",
    render: renderMemory,
    check: checkMemory
  }
];

function renderHome() {
  if (sessionCode && sessionInfo?.ended) return renderEventEnded();
  stopTimer();
  topbar.hidden = true;
  progressTrack.hidden = true;
  app.innerHTML = `
    <section class="screen hero">
      <div class="hero-copy">
        <p class="eyebrow">Интерактивное расследование</p>
        <h1><span class="title-line">Операция:</span><span class="title-line title-name">«Молодая гвардия»</span></h1>
        <p class="lead">Шесть архивных миссий. Факты, шифры и решения на скорость. Соберите код, который откроет цифровое дело.</p>
      </div>
      <form class="case-file" id="start-form">
        <p class="eyebrow">Допуск к материалам</p>
        <h2>Представьтесь</h2>
        <p>${sessionCode ? sessionInfo ? `Сеанс «${escapeHtml(sessionInfo.title)}» · ${escapeHtml(sessionInfo.event)}. Псевдоним и результаты будут доступны организатору мероприятия.` : escapeHtml(sessionError || "Проверяем код игрового сеанса…") : "Каждый участник проходит игру самостоятельно. Имя сохраняется только на этом устройстве."}</p>
        <div class="mission-facts">
          <div><strong>6</strong><span>миссий</span></div>
          <div><strong>20</strong><span>минут</span></div>
          <div><strong>1</strong><span>код</span></div>
        </div>
        <label class="field">
          <span>${sessionCode ? "Псевдоним участника" : "Имя участника"}</span>
          <input type="text" id="participant-name" maxlength="28" autocomplete="off" placeholder="Например, Алексей" required>
        </label>
        <div class="start-actions">
          <button class="primary-button" type="submit" ${sessionCode && !sessionInfo ? "disabled" : ""}>Начать личное прохождение</button>
          ${sessionCode ? "" : '<button class="secondary-button" id="leaderboard-button" type="button">Таблица результатов</button>'}
          <p class="feedback" id="start-feedback" role="status"></p>
        </div>
      </form>
    </section>`;

  document.querySelector("#start-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.querySelector("#participant-name").value.trim();
    if (!name) return;
    const button = event.currentTarget.querySelector('[type="submit"]');
    if (sessionCode) {
      button.disabled = true;
      try {
        state.remoteAttempt = await gameRequest("/api/attempt", { action: "start", code: sessionCode, nickname: name });
      } catch (error) {
        if (error.message === "Мероприятие завершено.") {
          sessionInfo.ended = true;
          renderEventEnded();
          return;
        }
        document.querySelector("#start-feedback").textContent = error.message;
        button.disabled = false;
        return;
      }
    } else {
      state.remoteAttempt = null;
    }
    Object.assign(state, {
      participant: name,
      missionIndex: 0,
      score: 0,
      clues: [],
      attempts: 0,
      hintUsed: false,
      startedAt: null,
      finishedAt: null,
      resultSaved: false,
      missions: [],
      resultUploaded: false
    });
    renderBriefing();
  });
  document.querySelector("#leaderboard-button")?.addEventListener("click", renderLeaderboard);
}

async function gameRequest(path, body) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось связаться с сервером.");
  return data;
}

async function loadSession() {
  try {
    const response = await fetch(`/api/session?code=${encodeURIComponent(sessionCode)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Сеанс не найден.");
    sessionInfo = data;
    if (!data.ended) {
      setTimeout(() => {
        sessionInfo.ended = true;
        renderEventEnded();
      }, Math.max(0, data.expiresAt - Date.now()));
    }
  } catch (error) {
    sessionError = `Не удалось открыть сеанс: ${error.message}`;
  }
  renderHome();
}

function renderBriefing() {
  topbar.hidden = false;
  progressTrack.hidden = false;
  timerNode.textContent = "--:--";
  missionCount.textContent = "Инструктаж";
  scoreNode.textContent = state.score;
  progressFill.style.width = "0%";
  app.innerHTML = `
    <section class="screen">
      <div class="document clue-reveal">
        <div>
          <p class="eyebrow">Участник «${escapeHtml(state.participant)}»</p>
          <h2 class="mission-title">Доступ разрешён</h2>
          <p class="fact-note">За каждую миссию вы получите часть финального кода. Ошибка не остановит игру, но уменьшит количество очков. Подсказка стоит 20 очков.</p>
          <p class="fact-note"><strong>Важно:</strong> задания проверяют знания, внимание и работу с источниками. Игровые реконструкции всегда обозначены отдельно.</p>
          <button class="primary-button" id="begin-button" type="button">Начать первую миссию</button>
        </div>
      </div>
    </section>`;
  document.querySelector("#begin-button").addEventListener("click", renderMission);
  focusApp();
}

function renderMission() {
  const mission = missionData[state.missionIndex];
  if (state.missionIndex === 0 && !state.startedAt) state.startedAt = Date.now();
  state.attempts = 0;
  state.hintUsed = false;
  state.secondsLeft = mission.time;

  missionCount.textContent = `Миссия ${state.missionIndex + 1}/${missionData.length}`;
  scoreNode.textContent = state.score;
  progressFill.style.width = `${(state.missionIndex / missionData.length) * 100}%`;
  app.innerHTML = `
    <section class="screen mission-layout">
      <article class="document">
        <p class="eyebrow">${mission.kicker}</p>
        <h2 class="mission-title">${mission.title}</h2>
        <p class="mission-brief">${mission.brief}</p>
        <div id="task-area"></div>
        <div class="task-actions">
          <button class="primary-button" id="check-button" type="button">Проверить решение</button>
          <button class="secondary-button" id="reset-button" type="button">Сбросить ответ</button>
        </div>
        <p class="feedback" id="feedback" role="status" aria-live="polite"></p>
      </article>
      <aside class="side-note">
        <p class="eyebrow">Полевые заметки</p>
        <h3>Правило миссии</h3>
        <p>За точность начисляется 100 очков, за скорость — до 50. Каждая неверная проверка снимает 10 очков.</p>
        <button class="secondary-button" id="hint-button" type="button">Открыть подсказку</button>
        <p id="hint-text" hidden></p>
      </aside>
    </section>`;

  mission.render();
  document.querySelector("#check-button").addEventListener("click", submitMission);
  document.querySelector("#reset-button").addEventListener("click", mission.render);
  document.querySelector("#hint-button").addEventListener("click", showHint);
  startTimer();
  focusApp();
}

function renderTimeline() {
  const shuffled = [timelineEvents[3], timelineEvents[0], timelineEvents[5], timelineEvents[2], timelineEvents[1], timelineEvents[4]];
  document.querySelector("#task-area").innerHTML = `
    <div class="timeline-list" id="timeline-list">
      ${shuffled.map((item) => `
        <button class="timeline-card" type="button" data-id="${item.id}">
          <span class="order-number">—</span>
          <span><strong>${item.text}</strong><br><small>${item.date}</small></span>
        </button>`).join("")}
    </div>`;

  const selected = [];
  document.querySelectorAll(".timeline-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.id;
      const existing = selected.indexOf(id);
      if (existing >= 0) selected.splice(existing, 1);
      else selected.push(id);
      document.querySelectorAll(".timeline-card").forEach((item) => {
        const position = selected.indexOf(item.dataset.id);
        item.classList.toggle("is-selected", position >= 0);
        item.querySelector(".order-number").textContent = position >= 0 ? position + 1 : "—";
      });
    });
  });
}

function checkTimeline() {
  const ordered = [...document.querySelectorAll(".timeline-card.is-selected")]
    .sort((a, b) => Number(a.querySelector(".order-number").textContent) - Number(b.querySelector(".order-number").textContent))
    .map((card) => card.dataset.id);
  const correct = timelineEvents.map((item) => item.id);
  return ordered.length === correct.length && ordered.every((id, index) => id === correct[index]);
}

function renderCipher() {
  document.querySelector("#task-area").innerHTML = `
    <div class="cipher-guide">
      <strong>Как расшифровать</strong>
      <ol>
        <li>Возьмите первую букву зашифрованного слова.</li>
        <li>Найдите её в русском алфавите.</li>
        <li>Замените её буквой, которая стоит на один шаг раньше.</li>
        <li>Повторите это с каждой буквой и соедините результат в слово.</li>
      </ol>
      <div class="cipher-example">
        <span class="example-label">Пример</span>
        <strong>ЕПН</strong>
        <span aria-hidden="true">→</span>
        <strong>ДОМ</strong>
      </div>
      <p class="example-steps">Е стоит после Д, П стоит после О, Н стоит после М. Поэтому: Е → Д, П → О, Н → М.</p>
    </div>
    <div class="cipher-box">
      <small>Зашифрованное слово / сдвиг +1</small>
      <p class="cipher-text">МЙТУПГЛБ</p>
    </div>
    <label class="field">
      <span>Расшифрованное слово</span>
      <input type="text" id="cipher-answer" autocomplete="off" placeholder="Введите восемь букв">
    </label>`;
}

function checkCipher() {
  return normalize(document.querySelector("#cipher-answer").value) === "ЛИСТОВКА";
}

function renderRoute() {
  document.querySelector("#task-area").innerHTML = `
    <div class="map-strip" aria-hidden="true">
      <span class="map-point">убежище</span><span class="map-point">контроль</span><span class="map-point">окраина</span><span class="map-point">точка</span>
    </div>
    <div class="route-grid">
      <div class="route-card"><label><input type="radio" name="route" value="a"><span><strong class="route-name">Маршрут А: рынок → площадь → школа</strong><span class="route-meta">Короткий путь · на площади отмечен патруль</span></span></label></div>
      <div class="route-card"><label><input type="radio" name="route" value="b"><span><strong class="route-name">Маршрут Б: балка → террикон → окраина</strong><span class="route-meta">Длинный путь · контрольных постов не отмечено</span></span></label></div>
      <div class="route-card"><label><input type="radio" name="route" value="c"><span><strong class="route-name">Маршрут В: станция → переезд → школа</strong><span class="route-meta">Средний путь · у станции отмечен пост</span></span></label></div>
    </div>`;
}

function checkRoute() {
  return document.querySelector('input[name="route"]:checked')?.value === "b";
}

const people = [
  { id: "turkenich", name: "Иван Туркенич", fact: "Имел фронтовой опыт; был командиром организации" },
  { id: "shevtsova", name: "Любовь Шевцова", fact: "Прошла специальную подготовку радистки" },
  { id: "tyulenin", name: "Сергей Тюленин", fact: "Один из первых начал подпольную деятельность в городе" },
  { id: "gromova", name: "Ульяна Громова", fact: "Окончила школу с отличием; входила в штаб организации" }
];

function renderMatching() {
  const optionOrder = [people[1], people[3], people[0], people[2]];
  document.querySelector("#task-area").innerHTML = `
    <div class="matching-grid">
      ${people.map((person) => `
        <label class="person-row">
          <span class="person-name">${person.name}</span>
          <select data-person="${person.id}" aria-label="Факт: ${person.name}">
            <option value="">Выберите факт</option>
            ${optionOrder.map((option) => `<option value="${option.id}">${option.fact}</option>`).join("")}
          </select>
        </label>`).join("")}
    </div>`;
}

function checkMatching() {
  return [...document.querySelectorAll("select[data-person]")].every((select) => select.value === select.dataset.person);
}

const sourceStatements = [
  { id: "flags", text: "К 7 ноября 1942 года в Краснодоне были вывешены красные флаги.", answer: "fact" },
  { id: "quote", text: "Любая дословная реплика героя в романе точно повторяет реальный разговор.", answer: "art" },
  { id: "count", text: "В двух публикациях указано разное число участников организации.", answer: "check" },
  { id: "novel", text: "Роман «Молодая гвардия» является художественным произведением.", answer: "fact" }
];

function renderSources() {
  document.querySelector("#task-area").innerHTML = `
    <div class="source-list">
      ${sourceStatements.map((item, index) => `
        <div class="source-card">
          <p><strong>${index + 1}.</strong> ${item.text}</p>
          <select data-source="${item.id}" aria-label="Статус утверждения ${index + 1}">
            <option value="">Выберите статус</option>
            <option value="fact">Установленный факт</option>
            <option value="art">Художественный образ, не документ</option>
            <option value="check">Нужно дополнительно проверить</option>
          </select>
        </div>`).join("")}
    </div>`;
}

function checkSources() {
  return sourceStatements.every((item) => document.querySelector(`[data-source="${item.id}"]`).value === item.answer);
}

let memoryTimeout;

function renderMemory() {
  clearTimeout(memoryTimeout);
  document.querySelector("#task-area").innerHTML = `
    <div class="memory-card" id="memory-card">
      <strong>УЧЕБНАЯ КАРТОЧКА № 17</strong>
      <dl>
        <div><dt>Позывной</dt><dd>СЕВЕР</dd></div>
        <div><dt>Время</dt><dd>06:40</dd></div>
        <div><dt>Пункт</dt><dd>МЕЛЬНИЦА</dd></div>
        <div><dt>Пакетов</dt><dd>12</dd></div>
      </dl>
    </div>
    <div class="memory-questions" id="memory-questions" hidden>
      <label class="field"><span>Позывной</span><input type="text" data-memory="code" autocomplete="off"></label>
      <label class="field"><span>Время</span><input type="text" data-memory="time" autocomplete="off" placeholder="00:00"></label>
      <label class="field"><span>Пункт</span><input type="text" data-memory="place" autocomplete="off"></label>
      <label class="field"><span>Количество пакетов</span><input type="text" data-memory="count" inputmode="numeric" autocomplete="off"></label>
    </div>
    <button class="small-button" id="memory-toggle" type="button">Закрыть карточку и отвечать</button>`;

  document.querySelector("#memory-toggle").addEventListener("click", hideMemoryCard);
  memoryTimeout = window.setTimeout(hideMemoryCard, 15000);
}

function hideMemoryCard() {
  clearTimeout(memoryTimeout);
  const card = document.querySelector("#memory-card");
  const questions = document.querySelector("#memory-questions");
  const button = document.querySelector("#memory-toggle");
  if (!card || card.classList.contains("is-hidden")) return;
  card.classList.add("is-hidden");
  card.innerHTML = "<strong>КАРТОЧКА ЗАКРЫТА</strong>";
  questions.hidden = false;
  button.textContent = "Посмотреть карточку ещё раз (−20)";
  button.addEventListener("click", revealMemoryCard, { once: true });
}

function revealMemoryCard() {
  state.hintUsed = true;
  const card = document.querySelector("#memory-card");
  card.classList.remove("is-hidden");
  card.innerHTML = `
    <strong>УЧЕБНАЯ КАРТОЧКА № 17</strong>
    <dl><div><dt>Позывной</dt><dd>СЕВЕР</dd></div><div><dt>Время</dt><dd>06:40</dd></div><div><dt>Пункт</dt><dd>МЕЛЬНИЦА</dd></div><div><dt>Пакетов</dt><dd>12</dd></div></dl>`;
  document.querySelector("#memory-toggle").disabled = true;
}

function checkMemory() {
  const values = Object.fromEntries([...document.querySelectorAll("[data-memory]")].map((input) => [input.dataset.memory, normalize(input.value)]));
  return values.code === "СЕВЕР" && values.time === "06:40" && values.place === "МЕЛЬНИЦА" && values.count === "12";
}

function submitMission() {
  const mission = missionData[state.missionIndex];
  const feedback = document.querySelector("#feedback");
  if (!mission.check()) {
    state.attempts += 1;
    playErrorSound();
    document.querySelector(".document").classList.remove("is-wrong");
    requestAnimationFrame(() => document.querySelector(".document").classList.add("is-wrong"));
    feedback.textContent = "В решении есть неточность. Проверьте все ответы и попробуйте ещё раз.";
    feedback.className = "feedback";
    return;
  }

  stopTimer();
  clearTimeout(memoryTimeout);
  const accuracyPoints = Math.max(40, 100 - state.attempts * 10);
  const speedPoints = Math.round((state.secondsLeft / mission.time) * 50);
  const hintPenalty = state.hintUsed ? 20 : 0;
  const earned = Math.max(20, accuracyPoints + speedPoints - hintPenalty);
  state.missions.push({ index: state.missionIndex + 1, attempts: state.attempts, hint: state.hintUsed, points: earned });
  state.score += earned;
  state.clues.push(mission.clue);
  scoreNode.textContent = state.score;
  playSuccessSound();
  renderClue(earned);
}

function renderClue(earned) {
  const mission = missionData[state.missionIndex];
  progressFill.style.width = `${((state.missionIndex + 1) / missionData.length) * 100}%`;
  timerNode.textContent = "ГОТОВО";
  app.innerHTML = `
    <section class="screen">
      <article class="document clue-reveal">
        <div>
          <p class="eyebrow">Миссия выполнена · +${earned} очков</p>
          <h2 class="mission-title">Фрагмент кода найден</h2>
          <div class="clue-stamp" aria-label="Фрагмент кода ${mission.clue}">${mission.clue}</div>
          <p class="fact-note">${mission.fact}</p>
          <button class="primary-button" id="continue-button" type="button">${state.missionIndex === missionData.length - 1 ? "Собрать финальный код" : "Следующая миссия"}</button>
        </div>
      </article>
    </section>`;
  document.querySelector("#continue-button").addEventListener("click", () => {
    state.missionIndex += 1;
    if (state.missionIndex < missionData.length) renderMission();
    else renderFinalCode();
  });
  focusApp();
}

function renderFinalCode() {
  missionCount.textContent = "Финал";
  timerNode.textContent = "--:--";
  app.innerHTML = `
    <section class="screen">
      <article class="document clue-reveal">
        <div>
          <p class="eyebrow">Финальный архив</p>
          <h2 class="mission-title">Соберите кодовое слово</h2>
          <p class="fact-note">Соедините найденные фрагменты в том порядке, в котором вы проходили миссии.</p>
          <div class="final-code">${state.clues.map((clue) => `<span class="clue-chip">${clue}</span>`).join("")}</div>
          <form class="final-form" id="final-form">
            <label class="field"><span>Кодовое слово</span><input type="text" id="final-answer" autocomplete="off" required></label>
            <button class="primary-button" type="submit">Открыть архив</button>
            <p class="feedback" id="final-feedback" role="status"></p>
          </form>
        </div>
      </article>
    </section>`;
  document.querySelector("#final-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (normalize(document.querySelector("#final-answer").value) === "КРАСНОДОН") renderResult();
    else {
      playErrorSound();
      document.querySelector("#final-feedback").textContent = "Код не подходит. Проверьте порядок всех фрагментов.";
    }
  });
  focusApp();
}

function renderResult() {
  topbar.hidden = true;
  progressTrack.hidden = true;
  state.finishedAt = Date.now();
  const elapsedSeconds = Math.max(1, Math.round((state.finishedAt - state.startedAt) / 1000));
  const elapsedTime = formatTime(elapsedSeconds);
  const rank = state.score >= 780 ? "Хранители истории" : state.score >= 620 ? "Исследователи архива" : "Начинающие поисковики";
  saveResult(elapsedSeconds);
  playFinalSound();
  app.innerHTML = `
    <section class="screen result-screen">
      <div class="confetti" aria-hidden="true">${Array.from({ length: 28 }, (_, index) => `<i class="confetti-piece" style="left:${(index * 37) % 100}%; animation-delay:${(index % 9) * 0.08}s"></i>`).join("")}</div>
      <div class="result-panel">
        <p class="eyebrow">Дело № 85 открыто</p>
        <h1>${rank}</h1>
        <p class="lead">Участник «${escapeHtml(state.participant)}» восстановил финальный код и завершил расследование.</p>
        <div class="score-seal"><div><strong>${state.score}</strong><span>очков</span></div></div>
        <p class="result-time">Время прохождения: <strong>${elapsedTime}</strong></p>
        <p class="lead">Память сохраняется не только в книгах и документах. Она продолжается, когда мы задаём вопросы, проверяем источники и узнаём судьбы людей.</p>
        <div class="result-actions">
          <button class="primary-button" id="share-button" type="button">Скопировать результат</button>
          ${sessionCode ? "" : '<button class="secondary-button" id="results-button" type="button">Сравнить результаты</button>'}
          <button class="secondary-button" id="restart-button" type="button">Пройти ещё раз</button>
        </div>
        <p id="share-status" aria-live="polite"></p>
        ${state.remoteAttempt ? '<p id="upload-status" role="status">Сохраняем результат мероприятия…</p><button class="secondary-button" id="retry-upload" type="button" hidden>Повторить отправку</button>' : ""}
      </div>
    </section>`;
  document.querySelector("#restart-button").addEventListener("click", renderHome);
  document.querySelector("#share-button").addEventListener("click", copyResult);
  document.querySelector("#results-button")?.addEventListener("click", renderLeaderboard);
  if (state.remoteAttempt) {
    document.querySelector("#retry-upload").addEventListener("click", () => uploadResult(elapsedSeconds));
    uploadResult(elapsedSeconds);
  }
  focusApp();
}

async function uploadResult(seconds) {
  if (state.resultUploaded) return;
  const status = document.querySelector("#upload-status");
  const retry = document.querySelector("#retry-upload");
  retry.hidden = true;
  status.textContent = "Сохраняем результат мероприятия…";
  try {
    await gameRequest("/api/attempt", { action: "finish", ...state.remoteAttempt, seconds, score: state.score, missions: state.missions });
    state.resultUploaded = true;
    status.textContent = "Результат сохранён в статистике мероприятия.";
  } catch (error) {
    if (error.message === "Мероприятие завершено.") {
      sessionInfo.ended = true;
      renderEventEnded();
      return;
    }
    status.textContent = `Не удалось сохранить результат: ${error.message}`;
    retry.hidden = false;
  }
}

async function copyResult() {
  const elapsedSeconds = Math.max(1, Math.round((state.finishedAt - state.startedAt) / 1000));
  const text = `${state.participant} — ${formatTime(elapsedSeconds)}, ${state.score} очков в игре «Операция: “Молодая гвардия”».`;
  const status = document.querySelector("#share-status");
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Результат скопирован.";
  } catch {
    status.textContent = text;
  }
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function loadResults() {
  try {
    return JSON.parse(localStorage.getItem(resultsStorageKey) || "[]");
  } catch {
    return [];
  }
}

function saveResult(elapsedSeconds) {
  if (state.resultSaved) return;
  const results = loadResults();
  results.push({
    name: state.participant,
    seconds: elapsedSeconds,
    score: state.score,
    date: new Date().toLocaleDateString("ru-RU")
  });
  results.sort((a, b) => a.seconds - b.seconds || b.score - a.score);
  try {
    localStorage.setItem(resultsStorageKey, JSON.stringify(results.slice(0, 50)));
  } catch {
    // Рейтинг необязателен: результат всё равно показывается участнику.
  }
  state.resultSaved = true;
}

function renderLeaderboard() {
  stopTimer();
  topbar.hidden = true;
  progressTrack.hidden = true;
  const results = loadResults();
  app.innerHTML = `
    <section class="screen">
      <article class="document leaderboard-document">
        <p class="eyebrow">Личный зачёт</p>
        <h2 class="mission-title">Кто быстрее?</h2>
        <p class="fact-note">Рейтинг хранится только в браузере на этом устройстве. Для сравнения участников с разных телефонов используйте кнопку «Скопировать результат» и передайте результаты ведущему.</p>
        ${results.length ? `<div class="leaderboard" role="table" aria-label="Таблица результатов">
          <div class="leaderboard-row leaderboard-head" role="row"><span>Место</span><span>Участник</span><span>Время</span><span>Очки</span></div>
          ${results.map((result, index) => `<div class="leaderboard-row" role="row"><strong>${index + 1}</strong><span>${escapeHtml(result.name)}</span><strong>${formatTime(result.seconds)}</strong><span>${result.score}</span></div>`).join("")}
        </div>` : `<p class="empty-results">Пока никто не завершил игру. Станьте первым участником.</p>`}
        <div class="result-actions">
          <button class="primary-button" id="leaderboard-start" type="button">Начать прохождение</button>
          <button class="secondary-button" id="leaderboard-home" type="button">На главный экран</button>
          ${results.length ? `<button class="small-button" id="clear-results" type="button">Очистить рейтинг</button>` : ""}
        </div>
      </article>
    </section>`;
  document.querySelector("#leaderboard-start").addEventListener("click", renderHome);
  document.querySelector("#leaderboard-home").addEventListener("click", renderHome);
  document.querySelector("#clear-results")?.addEventListener("click", () => {
    localStorage.removeItem(resultsStorageKey);
    renderLeaderboard();
  });
  focusApp();
}

function showHint() {
  const mission = missionData[state.missionIndex];
  state.hintUsed = true;
  const text = document.querySelector("#hint-text");
  text.hidden = false;
  text.textContent = mission.hint;
  document.querySelector("#hint-button").disabled = true;
}

function startTimer() {
  stopTimer();
  updateTimer();
  state.timerId = window.setInterval(() => {
    state.secondsLeft = Math.max(0, state.secondsLeft - 1);
    updateTimer();
    if (state.secondsLeft === 0) stopTimer();
  }, 1000);
}

function stopTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
  timerNode.classList.remove("is-low");
}

function updateTimer() {
  const minutes = Math.floor(state.secondsLeft / 60).toString().padStart(2, "0");
  const seconds = (state.secondsLeft % 60).toString().padStart(2, "0");
  timerNode.textContent = `${minutes}:${seconds}`;
  timerNode.classList.toggle("is-low", state.secondsLeft > 0 && state.secondsLeft <= 15);
}

function normalize(value) {
  return value.trim().toLocaleUpperCase("ru-RU").replaceAll("Ё", "Е").replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function focusApp() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  app.focus({ preventScroll: true });
}

document.querySelector("#home-link").addEventListener("click", (event) => {
  event.preventDefault();
  if (window.confirm("Прервать прохождение и вернуться на главный экран?")) renderHome();
});

const aboutDialog = document.querySelector("#about-dialog");
document.querySelector("#about-button").addEventListener("click", () => aboutDialog.showModal());
document.querySelector("[data-close-dialog]").addEventListener("click", () => aboutDialog.close());
aboutDialog.addEventListener("click", (event) => {
  if (event.target === aboutDialog) aboutDialog.close();
});

renderHome();
if (sessionCode) loadSession();
