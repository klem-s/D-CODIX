(function () {
  "use strict";

  var CODE_LENGTH = 5;
  var MAX_ATTEMPTS = 8;
  var EPOCH = Date.UTC(2026, 10, 7); // #1 le 2026-11-07 (UTC)
  var STORAGE_DAILY = "decodix_daily_v1";
  var STORAGE_STREAK = "decodix_streak_v1";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- utilitaires ----------

  function todayUTCString() {
    var d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  }

  function puzzleNumber(dateStr) {
    var t = Date.UTC.apply(
      null,
      dateStr.split("-").map(function (n, i) { return i === 1 ? Number(n) - 1 : Number(n); })
    );
    return Math.floor((t - EPOCH) / 86400000) + 1;
  }

  function seededRng(seedStr) {
    var h = 1779033703 ^ seedStr.length;
    for (var i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822519);
      h = Math.imul(h ^ (h >>> 13), 3266489917);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  function makeSecret(rngFn) {
    var digits = [];
    for (var i = 0; i < CODE_LENGTH; i++) digits.push(Math.floor(rngFn() * 10));
    return digits;
  }

  function evaluateGuess(guess, secret) {
    var n = secret.length;
    var result = new Array(n).fill("absent");
    var used = new Array(n).fill(false);
    for (var i = 0; i < n; i++) {
      if (guess[i] === secret[i]) {
        result[i] = "ok";
        used[i] = true;
      }
    }
    for (var i = 0; i < n; i++) {
      if (result[i] === "ok") continue;
      for (var j = 0; j < n; j++) {
        if (!used[j] && secret[j] === guess[i]) {
          result[i] = "warn";
          used[j] = true;
          break;
        }
      }
    }
    return result;
  }

  function sumDigits(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
  function evenCount(arr) { return arr.filter(function (d) { return d % 2 === 0; }).length; }

  function metaFor(guess, secret) {
    var gs = sumDigits(guess), ss = sumDigits(secret);
    var gp = evenCount(guess), sp = evenCount(secret);
    return [
      { tag: "Σ", arrow: ss === gs ? "=" : ss > gs ? "↑" : "↓", state: ss === gs ? "ok" : "warn" },
      { tag: "PAR", arrow: sp === gp ? "=" : sp > gp ? "↑" : "↓", state: sp === gp ? "ok" : "warn" }
    ];
  }

  function won(feedback) { return feedback.every(function (s) { return s === "ok"; }); }

  // ---------- état ----------

  var dailyState = null;
  var quickState = null;
  var currentMode = "daily";

  function freshState(secret) {
    return { secret: secret, guesses: [], current: [], status: "playing" };
  }

  function loadDaily() {
    var dateStr = todayUTCString();
    var secret = makeSecret(seededRng("decodix-" + dateStr));
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_DAILY) || "null"); } catch (e) {}
    if (saved && saved.date === dateStr) {
      return { secret: secret, guesses: saved.guesses, current: [], status: saved.status, date: dateStr };
    }
    return Object.assign(freshState(secret), { date: dateStr });
  }

  function persistDaily() {
    try {
      localStorage.setItem(STORAGE_DAILY, JSON.stringify({
        date: dailyState.date,
        guesses: dailyState.guesses,
        status: dailyState.status
      }));
    } catch (e) {}
  }

  function getStreak() {
    try { return JSON.parse(localStorage.getItem(STORAGE_STREAK) || "null") || { streak: 0, lastWin: null }; }
    catch (e) { return { streak: 0, lastWin: null }; }
  }

  function updateStreakOnWin(dateStr) {
    var s = getStreak();
    if (s.lastWin) {
      var prev = new Date(s.lastWin + "T00:00:00Z").getTime();
      var cur = new Date(dateStr + "T00:00:00Z").getTime();
      s.streak = (cur - prev === 86400000) ? s.streak + 1 : 1;
    } else {
      s.streak = 1;
    }
    s.lastWin = dateStr;
    try { localStorage.setItem(STORAGE_STREAK, JSON.stringify(s)); } catch (e) {}
    return s.streak;
  }

  function newQuickState() {
    return freshState(makeSecret(Math.random));
  }

  // ---------- rendu ----------

  var boardEl = document.getElementById("board");
  var statEl = document.getElementById("stat");
  var statusEl = document.getElementById("status");
  var actionsEl = document.getElementById("actions");
  var keypadEl = document.getElementById("keypad");
  var puzzleNoEl = document.getElementById("puzzle-no");
  var puzzleDateEl = document.getElementById("puzzle-date");
  var tabDaily = document.getElementById("tab-daily");
  var tabQuick = document.getElementById("tab-quick");

  function activeState() { return currentMode === "daily" ? dailyState : quickState; }

  function buildRow(idxLabel) {
    var row = document.createElement("div");
    row.className = "row";

    var idx = document.createElement("div");
    idx.className = "idx";
    idx.textContent = idxLabel;
    row.appendChild(idx);

    var digitsEl = document.createElement("div");
    digitsEl.className = "digits";
    var slots = [];
    for (var i = 0; i < CODE_LENGTH; i++) {
      var slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.state = "idle";
      slot.innerHTML = '<span class="slot-val"></span>';
      digitsEl.appendChild(slot);
      slots.push(slot);
    }
    row.appendChild(digitsEl);

    var gaugesEl = document.createElement("div");
    gaugesEl.className = "gauges";
    var gaugeEls = [];
    for (var g = 0; g < 2; g++) {
      var el = document.createElement("div");
      el.className = "gauge";
      el.dataset.state = "idle";
      el.innerHTML = '<span class="tag"></span><span class="arrow"></span>';
      gaugesEl.appendChild(el);
      gaugeEls.push(el);
    }
    row.appendChild(gaugesEl);

    return { row: row, slots: slots, gaugesEl: gaugesEl, gaugeEls: gaugeEls };
  }

  function setSlotFinal(slot, state, value) {
    slot.dataset.state = state;
    slot.querySelector(".slot-val").textContent = value === undefined ? "" : value;
  }

  function revealSlotAnimated(slot, state, value, done) {
    if (reduced) { setSlotFinal(slot, state, value); done && done(); return; }
    slot.classList.add("flip");
    setTimeout(function () {
      setSlotFinal(slot, state, value);
      slot.classList.remove("flip");
      done && done();
    }, 150);
  }

  function setGaugesFinal(refs, meta) {
    meta.forEach(function (m, i) {
      refs.gaugeEls[i].dataset.state = m.state;
      refs.gaugeEls[i].querySelector(".tag").textContent = m.tag;
      refs.gaugeEls[i].querySelector(".arrow").textContent = m.arrow;
    });
    refs.gaugesEl.classList.add("shown");
  }

  function renderBoard(state, animateLast) {
    boardEl.innerHTML = "";
    for (var i = 0; i < MAX_ATTEMPTS; i++) {
      var refs = buildRow((i + 1) + ".");
      if (i < state.guesses.length) {
        var guess = state.guesses[i];
        var feedback = evaluateGuess(guess, state.secret);
        var meta = metaFor(guess, state.secret);
        var isLast = i === state.guesses.length - 1;
        if (isLast && animateLast) {
          (function (refs, guess, feedback, meta) {
            var t = 0;
            guess.forEach(function (d, di) {
              setTimeout(function () { revealSlotAnimated(refs.slots[di], feedback[di], d); }, t);
              t += reduced ? 0 : 140;
            });
            t += reduced ? 0 : 200;
            setTimeout(function () { setGaugesFinal(refs, meta); }, t);
            t += reduced ? 0 : 500;
            setTimeout(onRowRevealed, t);
          })(refs, guess, feedback, meta);
        } else {
          guess.forEach(function (d, di) { setSlotFinal(refs.slots[di], feedback[di], d); });
          setGaugesFinal(refs, meta);
        }
      } else if (i === state.guesses.length && state.status === "playing") {
        for (var s = 0; s < CODE_LENGTH; s++) {
          if (s < state.current.length) setSlotFinal(refs.slots[s], "typed", state.current[s]);
          else if (s === state.current.length) refs.slots[s].dataset.state = "cursor";
        }
      }
      boardEl.appendChild(refs.row);
    }
  }

  function onRowRevealed() {
    refreshReadout();
    if (activeState().status !== "playing") lockKeypad();
  }

  function lockKeypad() {
    Array.prototype.forEach.call(keypadEl.querySelectorAll("button"), function (b) { b.disabled = true; });
  }
  function unlockKeypad() {
    Array.prototype.forEach.call(keypadEl.querySelectorAll("button"), function (b) { b.disabled = false; });
  }

  function refreshReadout() {
    var state = activeState();
    statusEl.className = "status";
    if (state.status === "won") {
      statusEl.textContent = "ACCÈS AUTORISÉ";
      statusEl.classList.add("win", "shown");
    } else if (state.status === "lost") {
      statusEl.textContent = "COFFRE BLOQUÉ — " + state.secret.join("");
      statusEl.classList.add("lose", "shown");
    } else {
      statusEl.classList.remove("shown");
    }

    if (currentMode === "daily") {
      var streak = getStreak().streak;
      statEl.innerHTML = "Essais : <b>" + state.guesses.length + "</b>/" + MAX_ATTEMPTS +
        (streak > 0 ? " &nbsp;·&nbsp; Série : <b>" + streak + "</b> jour" + (streak > 1 ? "s" : "") + " 🔥" : "");
    } else {
      statEl.innerHTML = "Essais : <b>" + state.guesses.length + "</b>/" + MAX_ATTEMPTS + " &nbsp;·&nbsp; mode rapide, sans classement";
    }

    renderActions(state);
  }

  function renderActions(state) {
    actionsEl.innerHTML = "";
    if (currentMode === "daily") {
      if (state.status !== "playing") {
        var shareBtn = document.createElement("button");
        shareBtn.type = "button";
        shareBtn.textContent = "Copier mon résultat";
        shareBtn.addEventListener("click", function () { shareResult(state, shareBtn); });
        actionsEl.appendChild(shareBtn);
      }
    } else {
      var newBtn = document.createElement("button");
      newBtn.type = "button";
      newBtn.textContent = "Nouvelle partie";
      newBtn.addEventListener("click", function () {
        quickState = newQuickState();
        unlockKeypad();
        renderBoard(quickState, false);
        refreshReadout();
      });
      actionsEl.appendChild(newBtn);
    }
  }

  function shareResult(state, btn) {
    var no = puzzleNumber(state.date);
    var lines = ["Décodix #" + no + " — " + (state.status === "won" ? state.guesses.length : "X") + "/" + MAX_ATTEMPTS];
    state.guesses.forEach(function (guess) {
      var feedback = evaluateGuess(guess, state.secret);
      var tiles = feedback.map(function (s) { return s === "ok" ? "🟩" : s === "warn" ? "🟧" : "⬜"; }).join("");
      var meta = metaFor(guess, state.secret);
      var metaStr = meta.map(function (m) {
        return m.arrow === "=" ? "✅" : m.arrow === "↑" ? "⬆️" : "⬇️";
      }).join("");
      lines.push(tiles + " " + metaStr);
    });
    var text = lines.join("\n");
    navigator.clipboard.writeText(text).then(function () {
      var old = btn.textContent;
      btn.textContent = "Copié !";
      setTimeout(function () { btn.textContent = old; }, 1600);
    }).catch(function () {});
  }

  function updateHeader() {
    if (currentMode === "daily") {
      puzzleNoEl.textContent = "Défi du jour · #" + puzzleNumber(dailyState.date);
      var d = new Date(dailyState.date + "T00:00:00Z");
      puzzleDateEl.textContent = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    } else {
      puzzleNoEl.textContent = "Mode rapide";
      puzzleDateEl.textContent = "partie libre";
    }
  }

  function switchMode(mode) {
    currentMode = mode;
    tabDaily.setAttribute("aria-selected", String(mode === "daily"));
    tabQuick.setAttribute("aria-selected", String(mode === "quick"));
    updateHeader();
    var state = activeState();
    (state.status === "playing") ? unlockKeypad() : lockKeypad();
    renderBoard(state, false);
    refreshReadout();
  }

  // ---------- saisie ----------

  function submitGuess() {
    var state = activeState();
    if (state.status !== "playing" || state.current.length !== CODE_LENGTH) return;
    state.guesses.push(state.current.slice());
    var feedback = evaluateGuess(state.current, state.secret);
    state.current = [];
    if (won(feedback)) {
      state.status = "won";
      if (currentMode === "daily") updateStreakOnWin(state.date);
    } else if (state.guesses.length >= MAX_ATTEMPTS) {
      state.status = "lost";
    }
    if (currentMode === "daily") persistDaily();
    lockKeypad();
    renderBoard(state, true);
  }

  function pressDigit(d) {
    var state = activeState();
    if (state.status !== "playing" || state.current.length >= CODE_LENGTH) return;
    state.current.push(d);
    renderBoard(state, false);
  }

  function pressBackspace() {
    var state = activeState();
    if (state.status !== "playing") return;
    state.current.pop();
    renderBoard(state, false);
  }

  keypadEl.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    if (btn.dataset.digit !== undefined) pressDigit(Number(btn.dataset.digit));
    else if (btn.id === "btn-back") pressBackspace();
    else if (btn.id === "btn-submit") submitGuess();
  });

  window.addEventListener("keydown", function (e) {
    if (e.key >= "0" && e.key <= "9") pressDigit(Number(e.key));
    else if (e.key === "Backspace") pressBackspace();
    else if (e.key === "Enter") submitGuess();
  });

  tabDaily.addEventListener("click", function () { switchMode("daily"); });
  tabQuick.addEventListener("click", function () { switchMode("quick"); });

  // ---------- démarrage ----------

  dailyState = loadDaily();
  quickState = newQuickState();
  updateHeader();
  renderBoard(dailyState, false);
  if (dailyState.status !== "playing") lockKeypad();
  refreshReadout();
})();
