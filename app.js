(function () {
  "use strict";

  var DAILY_CODE_LENGTH = 6;
  var DAILY_MAX_ATTEMPTS = 8;
  var CODE_LENGTH_MIN = 3, CODE_LENGTH_MAX = 7;
  var MAX_ATTEMPTS_MIN = 6, MAX_ATTEMPTS_MAX = 12;
  var TIME_LIMIT_OPTIONS = [60, 90, 120, 180, 300];
  var TIME_LIMIT_DEFAULT = 120;
  var EPOCH = Date.UTC(2026, 10, 7); // #1 le 2026-11-07 (UTC)
  var STORAGE_DAILY = "decodix_daily_v1";
  var STORAGE_STREAK = "decodix_streak_v1";
  var STORAGE_QUICK = "decodix_quick_v1";
  var STORAGE_QUICK_STATS = "decodix_quick_stats_v1";
  var STORAGE_QUICK_SETTINGS = "decodix_quick_settings_v1";
  var STORAGE_BADGES = "decodix_badges_v1";
  var STORAGE_HISTORY = "decodix_history_v1";
  var STORAGE_PREFS = "decodix_prefs_v1";
  var STORAGE_TUTORIAL_SEEN = "decodix_tutorial_seen_v1";
  var BADGE_THRESHOLDS = [3, 7, 14, 30, 100];

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

  function makeSecret(rngFn, length, allowRepeats) {
    if (allowRepeats) {
      var digits = [];
      for (var i = 0; i < length; i++) digits.push(Math.floor(rngFn() * 10));
      return digits;
    }
    var pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rngFn() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, length);
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

  // nombre de pastilles .gauge à construire par ligne, dérivé de metaFor (jamais codé en dur)
  var META_COUNT = metaFor([0], [0]).length;

  function won(feedback) { return feedback.every(function (s) { return s === "ok"; }); }

  // ---------- son & vibration ----------

  function getPrefs() {
    try {
      return Object.assign({ sound: false, vibration: false }, JSON.parse(localStorage.getItem(STORAGE_PREFS) || "null") || {});
    } catch (e) { return { sound: false, vibration: false }; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(STORAGE_PREFS, JSON.stringify(p)); } catch (e) {}
  }

  var prefs = getPrefs();
  var audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function playTone(freq, duration, type, gainPeak) {
    if (!prefs.sound) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.14, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  function playSequence(notes) {
    if (!prefs.sound) return;
    notes.forEach(function (n) {
      setTimeout(function () { playTone(n.freq, n.duration, n.type, n.gain); }, n.delay || 0);
    });
  }

  function vibrate(pattern) {
    if (!prefs.vibration || !navigator.vibrate) return;
    navigator.vibrate(pattern);
  }

  function sfxTap() { playTone(440, 0.05, "square", 0.05); vibrate(8); }
  function sfxBackspace() { playTone(300, 0.05, "square", 0.04); }
  function sfxError() { playTone(140, 0.18, "sawtooth", 0.1); vibrate([30, 40, 30]); }
  function sfxGuess() { playTone(520, 0.1, "sine", 0.09); vibrate(15); }
  function sfxWin() {
    playSequence([
      { freq: 523, duration: .12, type: "sine", delay: 0 },
      { freq: 659, duration: .12, type: "sine", delay: 110 },
      { freq: 784, duration: .22, type: "sine", delay: 220 }
    ]);
    vibrate([20, 40, 20, 40, 60]);
  }
  function sfxLose() { playTone(160, 0.4, "sawtooth", 0.1); vibrate([80, 40, 80]); }
  function sfxBadge() {
    playSequence([
      { freq: 660, duration: .1, type: "triangle", delay: 0 },
      { freq: 880, duration: .18, type: "triangle", delay: 100 }
    ]);
    vibrate([15, 30, 15]);
  }

  // ---------- état ----------

  var dailyState = null;
  var quickState = null;
  var duelState = null;
  var currentMode = "daily";

  function freshState(secret, codeLength, maxAttempts) {
    return { secret: secret, guesses: [], current: [], status: "playing", codeLength: codeLength, maxAttempts: maxAttempts };
  }

  function loadDaily() {
    var dateStr = todayUTCString();
    var secret = makeSecret(seededRng("decodix-" + dateStr), DAILY_CODE_LENGTH, true);
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_DAILY) || "null"); } catch (e) {}
    // saved.codeLength protège contre une partie du jour sauvegardée avant un changement
    // de DAILY_CODE_LENGTH (sinon les essais déjà tapés auraient la mauvaise longueur).
    if (saved && saved.date === dateStr && saved.codeLength === DAILY_CODE_LENGTH && saved.maxAttempts === DAILY_MAX_ATTEMPTS) {
      return {
        secret: secret, guesses: saved.guesses, current: saved.current || [], status: saved.status, date: dateStr,
        codeLength: DAILY_CODE_LENGTH, maxAttempts: DAILY_MAX_ATTEMPTS
      };
    }
    return Object.assign(freshState(secret, DAILY_CODE_LENGTH, DAILY_MAX_ATTEMPTS), { date: dateStr });
  }

  function persistDaily() {
    try {
      localStorage.setItem(STORAGE_DAILY, JSON.stringify({
        date: dailyState.date,
        guesses: dailyState.guesses,
        current: dailyState.current,
        status: dailyState.status,
        codeLength: dailyState.codeLength,
        maxAttempts: dailyState.maxAttempts
      }));
    } catch (e) {}
  }

  function getStreak() {
    try { return JSON.parse(localStorage.getItem(STORAGE_STREAK) || "null") || { streak: 0, lastWin: null, maxStreak: 0 }; }
    catch (e) { return { streak: 0, lastWin: null, maxStreak: 0 }; }
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
    if (!s.maxStreak || s.streak > s.maxStreak) s.maxStreak = s.streak;
    try { localStorage.setItem(STORAGE_STREAK, JSON.stringify(s)); } catch (e) {}
    checkBadges(s.streak);
    return s.streak;
  }

  function getBadges() {
    try { return JSON.parse(localStorage.getItem(STORAGE_BADGES) || "null") || { unlocked: [] }; }
    catch (e) { return { unlocked: [] }; }
  }

  function checkBadges(streak) {
    var badges = getBadges();
    var newlyUnlocked = [];
    BADGE_THRESHOLDS.forEach(function (t) {
      if (streak >= t && badges.unlocked.indexOf(t) === -1) {
        badges.unlocked.push(t);
        newlyUnlocked.push(t);
      }
    });
    if (newlyUnlocked.length) {
      try { localStorage.setItem(STORAGE_BADGES, JSON.stringify(badges)); } catch (e) {}
      newlyUnlocked.forEach(function (t) { showBadgeToast(t); });
    }
    return badges;
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function getQuickSettings() {
    var defaults = {
      codeLength: DAILY_CODE_LENGTH, maxAttempts: DAILY_MAX_ATTEMPTS, allowRepeats: true,
      timed: false, timeLimit: TIME_LIMIT_DEFAULT
    };
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_QUICK_SETTINGS) || "null");
      if (!saved) return defaults;
      return {
        codeLength: clamp(Number(saved.codeLength) || defaults.codeLength, CODE_LENGTH_MIN, CODE_LENGTH_MAX),
        maxAttempts: clamp(Number(saved.maxAttempts) || defaults.maxAttempts, MAX_ATTEMPTS_MIN, MAX_ATTEMPTS_MAX),
        allowRepeats: saved.allowRepeats !== false,
        timed: saved.timed === true,
        timeLimit: TIME_LIMIT_OPTIONS.indexOf(Number(saved.timeLimit)) !== -1 ? Number(saved.timeLimit) : defaults.timeLimit
      };
    } catch (e) { return defaults; }
  }

  function saveQuickSettings(settings) {
    try { localStorage.setItem(STORAGE_QUICK_SETTINGS, JSON.stringify(settings)); } catch (e) {}
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || "null") || {}; }
    catch (e) { return {}; }
  }

  function recordHistory(dateStr, status) {
    var hist = getHistory();
    hist[dateStr] = status;
    try { localStorage.setItem(STORAGE_HISTORY, JSON.stringify(hist)); } catch (e) {}
  }

  function newQuickState() {
    var cfg = getQuickSettings();
    var state = freshState(makeSecret(Math.random, cfg.codeLength, cfg.allowRepeats), cfg.codeLength, cfg.maxAttempts);
    state.timed = cfg.timed;
    state.timeLimit = cfg.timeLimit;
    state.startedAt = cfg.timed ? Date.now() : null;
    state.timedOut = false;
    return state;
  }

  function loadQuick() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_QUICK) || "null"); } catch (e) {}
    if (saved && Array.isArray(saved.secret) && saved.codeLength && saved.maxAttempts && saved.secret.length === saved.codeLength) {
      return {
        secret: saved.secret,
        guesses: saved.guesses || [],
        current: saved.current || [],
        status: saved.status || "playing",
        codeLength: saved.codeLength,
        maxAttempts: saved.maxAttempts,
        timed: saved.timed === true,
        timeLimit: saved.timeLimit || TIME_LIMIT_DEFAULT,
        startedAt: saved.startedAt || null,
        timedOut: saved.timedOut === true
      };
    }
    return newQuickState();
  }

  function persistQuick() {
    try {
      localStorage.setItem(STORAGE_QUICK, JSON.stringify({
        secret: quickState.secret,
        guesses: quickState.guesses,
        current: quickState.current,
        status: quickState.status,
        codeLength: quickState.codeLength,
        maxAttempts: quickState.maxAttempts,
        timed: quickState.timed,
        timeLimit: quickState.timeLimit,
        startedAt: quickState.startedAt,
        timedOut: quickState.timedOut
      }));
    } catch (e) {}
  }

  function duelStorageKey(seed) { return "decodix_duel_" + seed; }

  function loadDuel(seed, fromName) {
    var secret = makeSecret(seededRng("decodix-duel-" + seed), DAILY_CODE_LENGTH, true);
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(duelStorageKey(seed)) || "null"); } catch (e) {}
    var stale = saved && (saved.codeLength !== DAILY_CODE_LENGTH || saved.maxAttempts !== DAILY_MAX_ATTEMPTS);
    return {
      secret: secret, codeLength: DAILY_CODE_LENGTH, maxAttempts: DAILY_MAX_ATTEMPTS,
      seed: seed, from: fromName || null,
      guesses: (!stale && saved && saved.guesses) || [],
      current: (!stale && saved && saved.current) || [],
      status: (!stale && saved && saved.status) || "playing"
    };
  }

  function persistDuel() {
    if (!duelState) return;
    try {
      localStorage.setItem(duelStorageKey(duelState.seed), JSON.stringify({
        guesses: duelState.guesses, current: duelState.current, status: duelState.status,
        codeLength: duelState.codeLength, maxAttempts: duelState.maxAttempts
      }));
    } catch (e) {}
  }

  function persistCurrentMode() {
    if (currentMode === "daily") persistDaily();
    else if (currentMode === "duel") persistDuel();
    else persistQuick();
  }

  function getQuickStats() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_QUICK_STATS) || "null") || {
        played: 0, wins: 0, totalWinAttempts: 0, bestAttempts: null, currentStreak: 0, bestStreak: 0
      };
    } catch (e) {
      return { played: 0, wins: 0, totalWinAttempts: 0, bestAttempts: null, currentStreak: 0, bestStreak: 0 };
    }
  }

  function updateQuickStatsOnEnd(state) {
    var stats = getQuickStats();
    stats.played += 1;
    if (state.status === "won") {
      stats.wins += 1;
      stats.totalWinAttempts += state.guesses.length;
      if (stats.bestAttempts === null || state.guesses.length < stats.bestAttempts) stats.bestAttempts = state.guesses.length;
      stats.currentStreak += 1;
      if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
    } else {
      stats.currentStreak = 0;
    }
    try { localStorage.setItem(STORAGE_QUICK_STATS, JSON.stringify(stats)); } catch (e) {}
    return stats;
  }

  // ---------- rendu ----------

  var boardEl = document.getElementById("board");
  var statEl = document.getElementById("stat");
  var statusEl = document.getElementById("status");
  var actionsEl = document.getElementById("actions");
  var keypadEl = document.getElementById("keypad");
  var btnBack = document.getElementById("btn-back");
  var puzzleNoEl = document.getElementById("puzzle-no");
  var puzzleDateEl = document.getElementById("puzzle-date");
  var tabDaily = document.getElementById("tab-daily");
  var tabQuick = document.getElementById("tab-quick");
  var tabDuel = document.getElementById("tab-duel");
  var badgeToastEl = document.getElementById("badge-toast");
  var badgeToastTimer = null;
  var srAnnouncerEl = document.getElementById("sr-announcer");
  var incompleteHintTimer = null;
  var btnSettings = document.getElementById("btn-settings");
  var settingsPanelEl = document.getElementById("settings-panel");
  var setLengthEl = document.getElementById("set-length");
  var setAttemptsEl = document.getElementById("set-attempts");
  var setRepeatsEl = document.getElementById("set-repeats");
  var setTimedEl = document.getElementById("set-timed");
  var setTimeLimitEl = document.getElementById("set-timelimit");
  var setTimeLimitRow = document.getElementById("set-timelimit-row");
  var setApplyEl = document.getElementById("set-apply");
  var timerEl = document.getElementById("timer");
  var btnHistory = document.getElementById("btn-history");
  var historyPanelEl = document.getElementById("history-panel");
  var historyGridEl = document.getElementById("history-grid");
  var btnSound = document.getElementById("btn-sound");
  var btnVibration = document.getElementById("btn-vibration");
  var btnHelp = document.getElementById("btn-help");
  var tutorialOverlayEl = document.getElementById("tutorial-overlay");
  var tutorialStepsEl = document.getElementById("tutorial-steps");
  var tutorialDotsEl = document.getElementById("tutorial-dots");
  var tutorialPrevEl = document.getElementById("tutorial-prev");
  var tutorialNextEl = document.getElementById("tutorial-next");
  var tutorialCloseEl = document.getElementById("tutorial-close");

  function activeState() {
    if (currentMode === "daily") return dailyState;
    if (currentMode === "duel") return duelState;
    return quickState;
  }

  function showBadgeToast(threshold) {
    if (!badgeToastEl) return;
    badgeToastEl.textContent = "🏅 Palier débloqué : " + threshold + " jours !";
    badgeToastEl.classList.add("shown");
    sfxBadge();
    if (badgeToastTimer) clearTimeout(badgeToastTimer);
    badgeToastTimer = setTimeout(function () { badgeToastEl.classList.remove("shown"); }, 3200);
  }

  function buildRow(idxLabel, codeLength) {
    var row = document.createElement("div");
    row.className = "row";

    var idx = document.createElement("div");
    idx.className = "idx";
    idx.textContent = idxLabel;
    row.appendChild(idx);

    var digitsEl = document.createElement("div");
    digitsEl.className = "digits";
    digitsEl.style.gridTemplateColumns = "repeat(" + codeLength + ", 1fr)";
    var slots = [];
    for (var i = 0; i < codeLength; i++) {
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
    for (var g = 0; g < META_COUNT; g++) {
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
    for (var i = 0; i < state.maxAttempts; i++) {
      var refs = buildRow((i + 1) + ".", state.codeLength);
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
        for (var s = 0; s < state.codeLength; s++) {
          if (s < state.current.length) setSlotFinal(refs.slots[s], "typed", state.current[s]);
          else if (s === state.current.length) refs.slots[s].dataset.state = "cursor";
        }
      }
      boardEl.appendChild(refs.row);
    }
    updateKeypadColors(state);
  }

  function onRowRevealed() {
    var status = activeState().status;
    if (status === "won") sfxWin();
    else if (status === "lost") sfxLose();
    else sfxGuess();
    refreshReadout();
    if (status === "playing") unlockKeypad();
    else lockKeypad();
  }

  function digitKnowledge(state) {
    var rank = { absent: 1, warn: 2, ok: 3 };
    var known = {};
    state.guesses.forEach(function (guess) {
      var feedback = evaluateGuess(guess, state.secret);
      guess.forEach(function (d, i) {
        var s = feedback[i];
        if (!known[d] || rank[s] > rank[known[d]]) known[d] = s;
      });
    });
    return known;
  }

  function keypadAriaLabel(digit, s) {
    if (s === "ok") return digit + ", bien placé dans le code";
    if (s === "warn") return digit + ", présent dans le code";
    if (s === "absent") return digit + ", absent du code";
    return String(digit);
  }

  function updateKeypadColors(state) {
    var known = digitKnowledge(state);
    Array.prototype.forEach.call(keypadEl.querySelectorAll("button[data-digit]"), function (btn) {
      var digit = Number(btn.dataset.digit);
      var s = known[digit];
      if (s) btn.dataset.state = s;
      else btn.removeAttribute("data-state");
      btn.setAttribute("aria-label", keypadAriaLabel(digit, s));
    });
  }

  function lockKeypad() {
    Array.prototype.forEach.call(keypadEl.querySelectorAll("button"), function (b) { b.disabled = true; });
  }
  function unlockKeypad() {
    Array.prototype.forEach.call(keypadEl.querySelectorAll("button"), function (b) { b.disabled = false; });
  }

  // ---------- accessibilité (lecteur d'écran + feedback de saisie) ----------

  function announce(text) {
    if (!srAnnouncerEl) return;
    srAnnouncerEl.textContent = text;
  }

  var DIGIT_STATE_LABEL = { ok: "bien placé", warn: "présent mal placé", absent: "absent" };
  var META_LABEL = { "Σ": "Somme", "PAR": "Parité" };

  function metaArrowLabel(arrow) {
    return arrow === "=" ? "identique" : arrow === "↑" ? "cible plus haute" : "cible plus basse";
  }

  function buildGuessAnnouncement(attemptNo, feedback, meta) {
    var digitsPart = feedback.map(function (s, i) {
      return "chiffre " + (i + 1) + " " + DIGIT_STATE_LABEL[s];
    }).join(", ");
    var metaPart = meta.map(function (m) {
      return (META_LABEL[m.tag] || m.tag) + " : " + metaArrowLabel(m.arrow);
    }).join(". ");
    return "Essai " + attemptNo + " : " + digitsPart + ". " + metaPart + ".";
  }

  function shakeActiveRow() {
    var state = activeState();
    var rows = boardEl.querySelectorAll(".row");
    var row = rows[state.guesses.length];
    if (!row) return;
    var digitsEl = row.querySelector(".digits");
    if (!digitsEl) return;
    digitsEl.classList.remove("shake");
    void digitsEl.offsetWidth; // force reflow pour pouvoir rejouer l'animation
    digitsEl.classList.add("shake");
  }

  function showIncompleteHint() {
    statusEl.classList.remove("win", "lose");
    statusEl.textContent = "Code incomplet";
    statusEl.classList.add("hint", "shown");
    announce("Code incomplet.");
    sfxError();
    if (incompleteHintTimer) clearTimeout(incompleteHintTimer);
    incompleteHintTimer = setTimeout(function () {
      statusEl.classList.remove("hint", "shown");
      statusEl.textContent = "";
    }, 1500);
  }

  function bestOkCount(state) {
    var best = 0;
    state.guesses.forEach(function (guess) {
      var feedback = evaluateGuess(guess, state.secret);
      var okCount = feedback.filter(function (s) { return s === "ok"; }).length;
      if (okCount > best) best = okCount;
    });
    return best;
  }

  function lossMessage(state) {
    var best = bestOkCount(state);
    if (best >= state.codeLength - 1) return "Il ne manquait qu'un chiffre !";
    if (best >= Math.ceil(state.codeLength / 2)) return "Tu touchais presque au but !";
    return "Pas facile, ce coffre... retente ta chance !";
  }

  function refreshReadout() {
    var state = activeState();
    statusEl.className = "status";
    if (incompleteHintTimer) { clearTimeout(incompleteHintTimer); incompleteHintTimer = null; }
    if (state.status === "won") {
      statusEl.textContent = "ACCÈS AUTORISÉ";
      statusEl.classList.add("win", "shown");
    } else if (state.status === "lost") {
      var msg = state.timedOut ? "⏱ Temps écoulé !" : lossMessage(state);
      statusEl.textContent = msg + " — " + state.secret.join("");
      statusEl.classList.add("lose", "shown");
    } else {
      statusEl.classList.remove("shown");
    }

    if (currentMode === "daily") {
      var streakInfo = getStreak();
      var badges = getBadges();
      var badgeHtml = "";
      if (badges.unlocked.length) {
        var sorted = badges.unlocked.slice().sort(function (a, b) { return a - b; });
        badgeHtml = " <span class=\"badge-list\" title=\"Paliers débloqués : " + sorted.join(", ") + " jours\">🏅" + badges.unlocked.length + "</span>";
      }
      statEl.innerHTML = "Essais : <b>" + state.guesses.length + "</b>/" + state.maxAttempts +
        (streakInfo.streak > 0 ? " &nbsp;·&nbsp; Série : <b>" + streakInfo.streak + "</b> · Record : <b>" + (streakInfo.maxStreak || streakInfo.streak) + "</b> 🔥" + badgeHtml : "");
    } else if (currentMode === "duel") {
      statEl.innerHTML = "Essais : <b>" + state.guesses.length + "</b>/" + state.maxAttempts + " &nbsp;·&nbsp; défi à deux, hors classement";
    } else {
      var qStats = getQuickStats();
      var winRate = qStats.played > 0 ? Math.round((qStats.wins / qStats.played) * 100) : 0;
      var avgAttempts = qStats.wins > 0 ? (qStats.totalWinAttempts / qStats.wins).toFixed(1) : "—";
      var best = qStats.bestAttempts === null ? "—" : qStats.bestAttempts;
      statEl.innerHTML = "Essais : <b>" + state.guesses.length + "</b>/" + state.maxAttempts +
        " &nbsp;·&nbsp; <b>" + qStats.played + "</b> partie" + (qStats.played === 1 ? "" : "s") +
        " · <b>" + winRate + "%</b> victoires · moy <b>" + avgAttempts + "</b> · meilleure <b>" + best + "</b>" +
        (qStats.currentStreak > 0 ? " &nbsp;·&nbsp; 🔥 <b>" + qStats.currentStreak + "</b> d'affilée" : "");
    }

    renderActions(state);
  }

  function renderActions(state) {
    actionsEl.innerHTML = "";
    if (currentMode === "daily" || currentMode === "duel") {
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
      newBtn.addEventListener("click", startNewQuickGame);
      actionsEl.appendChild(newBtn);

      var challengeBtn = document.createElement("button");
      challengeBtn.type = "button";
      challengeBtn.textContent = "Défier un ami";
      challengeBtn.addEventListener("click", function () { challengeFriend(challengeBtn); });
      actionsEl.appendChild(challengeBtn);
    }
  }

  function startNewQuickGame() {
    quickState = newQuickState();
    persistQuick();
    unlockKeypad();
    renderBoard(quickState, false);
    refreshReadout();
    tickTimer();
  }

  function shareText(text, btn, shareLabel, copyLabel) {
    var oldLabel = btn.textContent;
    function flashLabel(label) {
      btn.textContent = label;
      setTimeout(function () { btn.textContent = oldLabel; }, 1600);
    }

    function fallbackCopy() {
      navigator.clipboard.writeText(text).then(function () {
        flashLabel(copyLabel);
      }).catch(function () {});
    }

    if (navigator.share) {
      navigator.share({ text: text }).then(function () {
        flashLabel(shareLabel);
      }).catch(function (err) {
        if (err && err.name === "AbortError") { flashLabel("Annulé"); return; }
        fallbackCopy();
      });
    } else {
      fallbackCopy();
    }
  }

  function shareResult(state, btn) {
    var lines;
    if (state.seed) {
      lines = ["Décodix · Duel" + (state.from ? " de " + state.from : "") + " — " +
        (state.status === "won" ? state.guesses.length : "X") + "/" + state.maxAttempts];
    } else {
      lines = ["Décodix #" + puzzleNumber(state.date) + " — " +
        (state.status === "won" ? state.guesses.length : "X") + "/" + state.maxAttempts];
    }
    state.guesses.forEach(function (guess) {
      var feedback = evaluateGuess(guess, state.secret);
      var tiles = feedback.map(function (s) { return s === "ok" ? "🟩" : s === "warn" ? "🟧" : "⬜"; }).join("");
      var meta = metaFor(guess, state.secret);
      var metaStr = meta.map(function (m) {
        return m.arrow === "=" ? "✅" : m.arrow === "↑" ? "⬆️" : "⬇️";
      }).join("");
      lines.push(tiles + " " + metaStr);
    });
    if (state.seed) {
      lines.push("🔗 " + buildDuelUrl(state.seed, null));
    } else {
      var streakInfo = getStreak();
      if (streakInfo.streak > 0) lines.push("🔥 Série : " + streakInfo.streak + " jours");
    }
    shareText(lines.join("\n"), btn, "Partagé !", "Copié !");
  }

  function makeRandomSeed() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function buildDuelUrl(seed, fromName) {
    var url = new URL(location.href);
    url.search = "";
    url.searchParams.set("duel", seed);
    if (fromName) url.searchParams.set("from", fromName);
    return url.toString();
  }

  function challengeFriend(btn) {
    var name = (window.prompt("Ton prénom pour le défi (optionnel) :", "") || "").trim().slice(0, 24);
    var url = buildDuelUrl(makeRandomSeed(), name);
    var text = (name ? name + " te défie sur Décodix ! " : "Défi Décodix ! ") +
      "Même code secret, qui le trouve en moins d'essais ?\n" + url;
    shareText(text, btn, "Lien partagé !", "Lien copié !");
  }

  function updateHeader() {
    if (currentMode === "daily") {
      puzzleNoEl.textContent = "Défi du jour · #" + puzzleNumber(dailyState.date);
      var d = new Date(dailyState.date + "T00:00:00Z");
      puzzleDateEl.textContent = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    } else if (currentMode === "duel") {
      puzzleNoEl.textContent = duelState.from ? "Duel · de " + duelState.from : "Duel entre amis";
      puzzleDateEl.textContent = "défi partagé";
    } else {
      puzzleNoEl.textContent = "Mode rapide";
      puzzleDateEl.textContent = "partie libre";
    }
  }

  function switchMode(mode) {
    currentMode = mode;
    tabDaily.setAttribute("aria-selected", String(mode === "daily"));
    tabQuick.setAttribute("aria-selected", String(mode === "quick"));
    tabDuel.setAttribute("aria-selected", String(mode === "duel"));
    btnSettings.hidden = mode !== "quick";
    if (mode !== "quick") closeSettingsPanel();
    btnHistory.hidden = mode !== "daily";
    if (mode !== "daily") { historyPanelEl.hidden = true; btnHistory.setAttribute("aria-expanded", "false"); }
    updateHeader();
    var state = activeState();
    (state.status === "playing") ? unlockKeypad() : lockKeypad();
    renderBoard(state, false);
    refreshReadout();
    tickTimer();
  }

  // ---------- réglages du mode rapide ----------

  function populateSettingsSelect(selectEl, min, max, current) {
    selectEl.innerHTML = "";
    for (var v = min; v <= max; v++) {
      var opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = String(v);
      if (v === current) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  function populateTimeLimitSelect(selectEl, current) {
    selectEl.innerHTML = "";
    TIME_LIMIT_OPTIONS.forEach(function (secs) {
      var opt = document.createElement("option");
      opt.value = String(secs);
      opt.textContent = (secs < 60 ? secs + "s" : (secs / 60) + " min");
      if (secs === current) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function fillSettingsPanel() {
    var cfg = getQuickSettings();
    populateSettingsSelect(setLengthEl, CODE_LENGTH_MIN, CODE_LENGTH_MAX, cfg.codeLength);
    populateSettingsSelect(setAttemptsEl, MAX_ATTEMPTS_MIN, MAX_ATTEMPTS_MAX, cfg.maxAttempts);
    setRepeatsEl.checked = cfg.allowRepeats;
    setTimedEl.checked = cfg.timed;
    populateTimeLimitSelect(setTimeLimitEl, cfg.timeLimit);
    setTimeLimitRow.hidden = !cfg.timed;
  }

  setTimedEl.addEventListener("change", function () {
    setTimeLimitRow.hidden = !setTimedEl.checked;
  });

  function closeSettingsPanel() {
    settingsPanelEl.hidden = true;
    btnSettings.setAttribute("aria-expanded", "false");
  }

  function toggleSettingsPanel() {
    if (settingsPanelEl.hidden) {
      fillSettingsPanel();
      settingsPanelEl.hidden = false;
      btnSettings.setAttribute("aria-expanded", "true");
    } else {
      closeSettingsPanel();
    }
  }

  btnSettings.addEventListener("click", toggleSettingsPanel);

  setApplyEl.addEventListener("click", function () {
    var codeLength = clamp(Number(setLengthEl.value), CODE_LENGTH_MIN, CODE_LENGTH_MAX);
    var maxAttempts = clamp(Number(setAttemptsEl.value), MAX_ATTEMPTS_MIN, MAX_ATTEMPTS_MAX);
    var allowRepeats = setRepeatsEl.checked;
    var timed = setTimedEl.checked;
    var timeLimit = clamp(Number(setTimeLimitEl.value) || TIME_LIMIT_DEFAULT, TIME_LIMIT_OPTIONS[0], TIME_LIMIT_OPTIONS[TIME_LIMIT_OPTIONS.length - 1]);
    saveQuickSettings({ codeLength: codeLength, maxAttempts: maxAttempts, allowRepeats: allowRepeats, timed: timed, timeLimit: timeLimit });
    closeSettingsPanel();
    startNewQuickGame();
  });

  // ---------- mode chronométré ----------

  function formatSeconds(s) {
    s = Math.max(0, Math.ceil(s));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  function timeRemaining(state) {
    return state.timeLimit - (Date.now() - state.startedAt) / 1000;
  }

  function tickTimer() {
    if (currentMode !== "quick" || !quickState.timed || quickState.status !== "playing") {
      timerEl.hidden = true;
      return;
    }
    var remaining = timeRemaining(quickState);
    if (remaining <= 0) {
      quickState.status = "lost";
      quickState.timedOut = true;
      sfxLose();
      updateQuickStatsOnEnd(quickState);
      persistQuick();
      lockKeypad();
      renderBoard(quickState, false);
      refreshReadout();
      return;
    }
    timerEl.hidden = false;
    timerEl.textContent = "⏱ " + formatSeconds(remaining);
    timerEl.classList.toggle("low", remaining <= 10);
  }

  setInterval(tickTimer, 1000);

  // ---------- historique du défi du jour ----------

  function renderHistoryGrid() {
    var hist = getHistory();
    var todayStr = todayUTCString();
    var todayMs = new Date(todayStr + "T00:00:00Z").getTime();
    var spanDays = 70; // 10 semaines
    var startMs = todayMs - (spanDays - 1) * 86400000;
    var startDow = (new Date(startMs).getUTCDay() + 6) % 7; // 0 = lundi
    startMs -= startDow * 86400000;
    var totalCells = Math.ceil((Math.round((todayMs - startMs) / 86400000) + 1) / 7) * 7;

    historyGridEl.innerHTML = "";
    ["L", "M", "M", "J", "V", "S", "D"].forEach(function (l) {
      var lab = document.createElement("div");
      lab.className = "hlabel";
      lab.textContent = l;
      historyGridEl.appendChild(lab);
    });
    for (var i = 0; i < totalCells; i++) {
      var cellMs = startMs + i * 86400000;
      var cell = document.createElement("div");
      cell.className = "hcell";
      if (cellMs > todayMs) {
        cell.classList.add("empty");
      } else {
        var dateStr = new Date(cellMs).toISOString().slice(0, 10);
        var status = hist[dateStr];
        if (status) cell.classList.add(status === "won" ? "ok" : "lose");
        if (dateStr === todayStr) cell.classList.add("today");
        cell.title = dateStr + (status ? (status === "won" ? " — gagné" : " — perdu") : " — non joué");
      }
      historyGridEl.appendChild(cell);
    }
  }

  function toggleHistoryPanel() {
    if (historyPanelEl.hidden) {
      renderHistoryGrid();
      historyPanelEl.hidden = false;
      btnHistory.setAttribute("aria-expanded", "true");
    } else {
      historyPanelEl.hidden = true;
      btnHistory.setAttribute("aria-expanded", "false");
    }
  }

  btnHistory.addEventListener("click", toggleHistoryPanel);

  // ---------- barre d'outils (son / vibration) ----------

  function refreshToolbarButtons() {
    btnSound.textContent = prefs.sound ? "🔊" : "🔇";
    btnSound.setAttribute("aria-pressed", String(prefs.sound));
    btnSound.setAttribute("aria-label", prefs.sound ? "Désactiver le son" : "Activer le son");
    btnVibration.setAttribute("aria-pressed", String(prefs.vibration));
    btnVibration.setAttribute("aria-label", prefs.vibration ? "Désactiver les vibrations" : "Activer les vibrations");
  }

  btnVibration.hidden = !("vibrate" in navigator);

  btnSound.addEventListener("click", function () {
    prefs.sound = !prefs.sound;
    savePrefs(prefs);
    refreshToolbarButtons();
    if (prefs.sound) { ensureAudio(); playTone(523, 0.08, "sine", 0.12); }
  });

  btnVibration.addEventListener("click", function () {
    prefs.vibration = !prefs.vibration;
    savePrefs(prefs);
    refreshToolbarButtons();
    if (prefs.vibration) vibrate(20);
  });

  refreshToolbarButtons();

  // ---------- saisie ----------

  function submitGuess() {
    var state = activeState();
    if (state.status !== "playing") return;
    if (state.current.length !== state.codeLength) {
      showIncompleteHint();
      shakeActiveRow();
      return;
    }
    var guessCopy = state.current.slice();
    state.guesses.push(guessCopy);
    var feedback = evaluateGuess(guessCopy, state.secret);
    var meta = metaFor(guessCopy, state.secret);
    state.current = [];
    if (won(feedback)) {
      state.status = "won";
      if (currentMode === "daily") { updateStreakOnWin(state.date); recordHistory(state.date, "won"); }
    } else if (state.guesses.length >= state.maxAttempts) {
      state.status = "lost";
      if (currentMode === "daily") recordHistory(state.date, "lost");
    }
    announce(buildGuessAnnouncement(state.guesses.length, feedback, meta));
    if (currentMode === "quick" && state.status !== "playing") updateQuickStatsOnEnd(state);
    if (!historyPanelEl.hidden) renderHistoryGrid();
    persistCurrentMode();
    lockKeypad();
    renderBoard(state, true);
  }

  function pressDigit(d) {
    var state = activeState();
    if (state.status !== "playing" || state.current.length >= state.codeLength) return;
    state.current.push(d);
    sfxTap();
    persistCurrentMode();
    renderBoard(state, false);
  }

  function pressBackspace() {
    var state = activeState();
    if (state.status !== "playing") return;
    state.current.pop();
    sfxBackspace();
    persistCurrentMode();
    renderBoard(state, false);
  }

  // "Tout effacer" : pas de nouveau bouton (la grille 3 colonnes du pavé reste
  // intacte) — un double-clic ou un appui long sur "Effacer" vide state.current
  // en un seul geste ; un simple clic garde son comportement habituel (1 chiffre).
  function pressClearAll() {
    var state = activeState();
    if (state.status !== "playing" || state.current.length === 0) return;
    state.current = [];
    sfxBackspace();
    persistCurrentMode();
    renderBoard(state, false);
    announce("Saisie effacée.");
  }

  var backLongPressTimer = null;
  var backLongPressFired = false;
  var BACK_LONG_PRESS_MS = 550;

  function startBackLongPress() {
    if (btnBack.disabled) return;
    backLongPressFired = false;
    clearTimeout(backLongPressTimer);
    backLongPressTimer = setTimeout(function () {
      backLongPressFired = true;
      pressClearAll();
    }, BACK_LONG_PRESS_MS);
  }
  function cancelBackLongPress() {
    clearTimeout(backLongPressTimer);
  }

  btnBack.addEventListener("pointerdown", startBackLongPress);
  btnBack.addEventListener("pointerup", cancelBackLongPress);
  btnBack.addEventListener("pointerleave", cancelBackLongPress);
  btnBack.addEventListener("pointercancel", cancelBackLongPress);
  btnBack.addEventListener("dblclick", function () { pressClearAll(); });

  keypadEl.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    if (btn.dataset.digit !== undefined) pressDigit(Number(btn.dataset.digit));
    else if (btn.id === "btn-back") {
      if (backLongPressFired) { backLongPressFired = false; return; }
      pressBackspace();
    }
    else if (btn.id === "btn-submit") submitGuess();
  });

  window.addEventListener("keydown", function (e) {
    if (e.key >= "0" && e.key <= "9") pressDigit(Number(e.key));
    else if (e.key === "Backspace") pressBackspace();
    else if (e.key === "Enter") submitGuess();
  });

  tabDaily.addEventListener("click", function () { switchMode("daily"); });
  tabQuick.addEventListener("click", function () { switchMode("quick"); });
  tabDuel.addEventListener("click", function () { switchMode("duel"); });

  // ---------- tutoriel interactif ----------

  var TUTORIAL_STEPS = [
    {
      title: "Devine le code",
      body: "Chaque jour, un code secret de " + DAILY_CODE_LENGTH + " chiffres se cache dans le coffre. Tape ta proposition sur le pavé puis valide pour voir où tu en es.",
      demo: "feedback"
    },
    {
      title: "Lis les indices",
      body: "Après chaque essai : vert ✓ = bien placé, orange ◆ = présent mais mal placé, gris – = absent. Deux jauges comparent aussi la somme (Σ) et le nombre de chiffres pairs (PAR) de ton essai au code secret.",
      demo: "meta"
    },
    {
      title: "Deux façons de jouer",
      body: "Le Défi du jour est le même pour tout le monde, une seule fois par jour. Le Mode rapide se joue à volonté, sans classement, avec des réglages de difficulté. Bonne chance !",
      demo: null
    }
  ];
  var tutorialStepIndex = 0;

  function tutorialDemoHTML(kind) {
    if (kind === "feedback") {
      return '<div class="tutorial-demo-row">' +
        '<div class="slot" data-state="ok"><span class="slot-val">4</span></div>' +
        '<div class="slot" data-state="warn"><span class="slot-val">7</span></div>' +
        '<div class="slot" data-state="absent"><span class="slot-val">2</span></div>' +
        '</div>';
    }
    if (kind === "meta") {
      return '<div class="tutorial-demo-gauges">' +
        '<div class="gauge" data-state="warn"><span class="tag">Σ</span><span class="arrow">↑</span></div>' +
        '<div class="gauge" data-state="ok"><span class="tag">PAR</span><span class="arrow">=</span></div>' +
        '</div>';
    }
    return "";
  }

  function renderTutorialStep() {
    var step = TUTORIAL_STEPS[tutorialStepIndex];
    tutorialStepsEl.innerHTML =
      "<h3>" + step.title + "</h3>" +
      '<p class="tutorial-body">' + step.body + "</p>" +
      tutorialDemoHTML(step.demo);

    tutorialDotsEl.innerHTML = "";
    TUTORIAL_STEPS.forEach(function (s, i) {
      var dot = document.createElement("span");
      if (i === tutorialStepIndex) dot.className = "active";
      tutorialDotsEl.appendChild(dot);
    });

    tutorialPrevEl.disabled = tutorialStepIndex === 0;
    var isLast = tutorialStepIndex === TUTORIAL_STEPS.length - 1;
    tutorialNextEl.textContent = isLast ? "C'est parti !" : "Suivant";
    tutorialNextEl.classList.toggle("primary", isLast);
  }

  function openTutorial() {
    tutorialStepIndex = 0;
    renderTutorialStep();
    tutorialOverlayEl.hidden = false;
  }

  function closeTutorial() {
    tutorialOverlayEl.hidden = true;
    try { localStorage.setItem(STORAGE_TUTORIAL_SEEN, "1"); } catch (e) {}
  }

  tutorialPrevEl.addEventListener("click", function () {
    if (tutorialStepIndex > 0) { tutorialStepIndex--; renderTutorialStep(); }
  });
  tutorialNextEl.addEventListener("click", function () {
    if (tutorialStepIndex < TUTORIAL_STEPS.length - 1) { tutorialStepIndex++; renderTutorialStep(); }
    else closeTutorial();
  });
  tutorialCloseEl.addEventListener("click", closeTutorial);
  btnHelp.addEventListener("click", openTutorial);

  var tutorialSeen = false;
  try { tutorialSeen = localStorage.getItem(STORAGE_TUTORIAL_SEEN) === "1"; } catch (e) {}
  if (!tutorialSeen) openTutorial();

  // ---------- démarrage ----------

  dailyState = loadDaily();
  quickState = loadQuick();

  var urlParams = new URLSearchParams(location.search);
  var duelSeed = urlParams.get("duel");
  var startMode = "daily";
  if (duelSeed) {
    duelState = loadDuel(duelSeed, urlParams.get("from"));
    tabDuel.hidden = false;
    startMode = "duel";
  }

  currentMode = startMode;
  tabDaily.setAttribute("aria-selected", String(startMode === "daily"));
  tabQuick.setAttribute("aria-selected", String(startMode === "quick"));
  tabDuel.setAttribute("aria-selected", String(startMode === "duel"));
  btnSettings.hidden = startMode !== "quick";
  btnHistory.hidden = startMode !== "daily";
  updateHeader();
  var startState = activeState();
  renderBoard(startState, false);
  if (startState.status !== "playing") lockKeypad();
  refreshReadout();
})();
