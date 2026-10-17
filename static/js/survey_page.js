/* ===========================================================================
   survey_page.js = 調査ページ（index.html）の画面の処理

   ▼ 役割の分け方
     測ること・サーバーに送ること … measure.js（DetherSurvey）。画面には触らない
     画面に描くこと               … このファイル。DetherSurvey のイベントを受け取って描くだけ
     イベントの中身は measure.js の先頭か docs/API_measurement.md を見る。

   ▼ バッジの見た目
     リーダーの部品 static/js/badge.js（DetherBadge）で作る。コード（b80 など）を渡すだけでよい。

   ▼ 開発用：マイクの無いPCで試すとき
     /?sim=loud（85dB前後）や /?sim=quiet（37dB前後）で開くと、マイクの代わりに作った音で動く。
     位置は東京駅になる。記録はふつうにサーバーへ送るので、本番のURLでは使わないこと。
   =========================================================================== */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ---------- 調整する数値はここだけ ---------- */
  const BAR_COUNT = 48; // 波形の本数
  const BAR_EVERY = 2; // level（100msごと）を何回受け取るたびに1本足すか。48本 × 200ms ≒ 10秒
  const RECENT_MAX = 3; // 「最近の記録」に出す件数（main/views.py の RECENT_COUNT と同じ）
  const WARNING_MS = 6000; // 85dBの案内を出しておく時間

  const Badge = window.DetherBadge;
  const NAMES = Badge.NAMES;

  const MODE_TEXT = {
    normal: "調査中",
    loud: "大きい音を判定中",
    quiet: "静寂を判定中",
    deep: "深い静寂を判定中",
  };
  const STATE_TEXT = { starting: "準備中", paused: "一時停止中", interrupted: "中断中" };

  // 音量の目安。ゲージの下のラベルと、波形の色に使う
  function toneOf(db) {
    if (db >= 85) return { tone: "very-loud", text: "かなり" };
    if (db >= 70) return { tone: "loud", text: "大きい" };
    if (db >= 55) return { tone: "normal", text: "ふつう" };
    if (db >= 40) return { tone: "calm", text: "おだやか" };
    return { tone: "quiet", text: "静か" };
  }

  const fmt1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "--");

  /* ---------- 調査の進行役（measure.js） ---------- */
  const sim = new URLSearchParams(location.search).get("sim");
  const survey = new DetherSurvey(sim ? { simulate: makeSimulator(sim), useLocation: false } : {});

  /* ---------- 画面の部品 ---------- */
  const view = { idle: $("survey-idle"), live: $("survey-live") };
  const pill = $("live-pill");
  const chip = $("gauge-chip");
  const wave = $("wave");
  const bars = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement("span");
    bar.style.height = "8%";
    wave.appendChild(bar);
    bars.push(bar);
  }

  // いまの区間の最大値と、波形を足すタイミング
  let segMax = -Infinity;
  let lastElapsed = 0;
  let lastMode = "normal";
  let tick = 0;
  let warningTimer = null;

  /* ---------- ボタン（★survey の操作は必ずボタンの処理の中で呼ぶ。iPhoneの決まり） ---------- */
  $("survey-start").addEventListener("click", () => {
    resetLive();
    showError("");
    survey.start();
  });
  $("survey-stop").addEventListener("click", () => survey.stop());
  $("survey-resume").addEventListener("click", () => survey.resume());
  $("badge-popup-continue").addEventListener("click", () => {
    closePopup();
    survey.resume();
  });
  $("badge-popup-stop").addEventListener("click", () => {
    closePopup();
    survey.stop();
  });

  /* ---------- measure.js からのイベント ---------- */
  survey.on("state", (e) => {
    const state = e.detail.state;
    const running = state !== "idle" && state !== "stopped";
    view.idle.hidden = running;
    view.live.hidden = !running;
    pill.dataset.state = state;
    if (STATE_TEXT[state]) pill.textContent = STATE_TEXT[state];
    $("survey-resume").hidden = state !== "interrupted";
    if (!running) {
      $("guide").hidden = true;
      $("warning").hidden = true;
    }
  });

  survey.on("level", (e) => {
    const d = e.detail;
    const now = Number.isFinite(d.level) ? d.level : d.db;

    // 区間が切り替わったら（経過秒数が戻る・判定が変わる）最大値を数え直す
    if (d.elapsed < lastElapsed || d.mode !== lastMode) segMax = -Infinity;
    lastElapsed = d.elapsed;
    lastMode = d.mode;
    segMax = Math.max(segMax, d.db);

    $("gauge-value").textContent = Math.round(now);
    const t = toneOf(now);
    chip.hidden = false;
    chip.textContent = t.text;
    chip.dataset.tone = t.tone;

    const progress = Math.min(1, Math.max(0, d.elapsed / d.target));
    $("gauge-bar").style.strokeDashoffset = String(100 * (1 - progress));
    $("live-progress").textContent =
      `${survey.sessionCount + 1}回目・${d.elapsed.toFixed(1)} / ${d.target} 秒`;
    $("live-avg").textContent = fmt1(d.segmentLeq);
    $("live-max").textContent = fmt1(segMax);

    if (survey.state === "measuring") {
      pill.textContent = MODE_TEXT[d.mode] || MODE_TEXT.normal;
      pill.dataset.mode = d.mode;
    }
    $("guide").hidden = !(d.guide && d.mode === "loud");

    tick += 1;
    if (tick % BAR_EVERY === 0) pushBar(now);
  });

  survey.on("warning", (e) => {
    $("warning-text").textContent =
      `いま ${e.detail.db} dB です。長くいると耳を傷めることがあります。長居しないでね`;
    $("warning").hidden = false;
    clearTimeout(warningTimer);
    warningTimer = setTimeout(() => ($("warning").hidden = true), WARNING_MS);
  });

  survey.on("recorded", (e) => {
    const d = e.detail;
    const note = d.badge ? `${NAMES[d.badge]}（この調査で獲得済み）` : "バッジなし";
    updateSession(d.result, note, null);
    addRecent(d.result, d.badge, d.timeBand);
  });

  survey.on("badge", (e) => {
    const d = e.detail;
    updateSession(d.result, d.name, d.badge);
    addRecent(d.result, d.badge, d.timeBand);
    openPopup(d);
  });

  survey.on("error", (e) => showError(e.detail.message));

  /* ---------- 描画の道具 ---------- */

  function resetLive() {
    segMax = -Infinity;
    lastElapsed = 0;
    lastMode = "normal";
    tick = 0;
    bars.forEach((bar) => {
      bar.style.height = "8%";
      delete bar.dataset.tone;
    });
    $("gauge-value").textContent = "--";
    $("gauge-bar").style.strokeDashoffset = "100";
    chip.hidden = true;
    $("live-progress").textContent = "";
    $("live-avg").textContent = "--";
    $("live-max").textContent = "--";
    $("session-count").textContent = "0";
    $("session-badge").replaceChildren();
    $("session-last").textContent = "直前の測定：まだありません";
    pill.textContent = STATE_TEXT.starting;
    delete pill.dataset.mode;
  }

  // 波形を左に1本ずらして、右端に今の音量を足す
  function pushBar(db) {
    for (let i = 0; i < BAR_COUNT - 1; i++) {
      bars[i].style.height = bars[i + 1].style.height;
      if (bars[i + 1].dataset.tone) bars[i].dataset.tone = bars[i + 1].dataset.tone;
      else delete bars[i].dataset.tone;
    }
    const last = bars[BAR_COUNT - 1];
    // 20dB〜110dB を高さ 8%〜100% にする
    last.style.height = `${Math.min(100, Math.max(8, ((db - 20) / 90) * 100))}%`;
    last.dataset.tone = toneOf(db).tone;
  }

  function updateSession(result, note, newBadge) {
    $("session-count").textContent = String(survey.sessionCount);
    $("session-last").textContent = `直前の測定：${fmt1(result.avgDb)} dB・${note}`;
    if (newBadge) $("session-badge").replaceChildren(Badge.medal(newBadge, "list"));
  }

  // 「最近の記録」の先頭に1行足す（タグは後から付けるので、ここではバッジ名か「タグなし」）
  function addRecent(result, badge, timeBand) {
    const row = $("recent-row").content.firstElementChild.cloneNode(true);
    const slot = (name) => row.querySelector(`[data-slot="${name}"]`);
    const at = result.endedAt;
    slot("db").textContent = fmt1(result.avgDb);
    slot("title").textContent = badge ? NAMES[badge] : "タグなし";
    slot("meta").textContent =
      `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, "0")}:` +
      `${String(at.getMinutes()).padStart(2, "0")}` + (timeBand ? `・${timeBand.name}` : "");
    if (badge) slot("badge").replaceWith(Badge.medal(badge, "md", { band: timeBand && timeBand.code }));
    else slot("badge").remove();

    const list = $("recent-list");
    list.prepend(row);
    while (list.children.length > RECENT_MAX) list.lastElementChild.remove();
    $("recent-empty").hidden = true;
  }

  function openPopup(d) {
    const band = d.timeBand ? d.timeBand.code : null; // "d"（昼）/ "n"（夜）
    // ★開くたびに作り直す。そうすると獲得の演出（ポンと出て光が走る）が毎回再生される
    $("badge-popup-medal").replaceChildren(Badge.medal(d.badge, "popup", { isNew: true, band }));
    $("badge-popup-title").textContent = d.name;
    const bandName = d.timeBand ? d.timeBand.name : "";
    $("badge-popup-note").textContent = bandName ? `${bandName}のバッジとして記録しました` : "記録しました";
    // 企画書：昼の静寂・深い静寂と夜の90dBはレア（判定は badge.js）
    $("badge-popup-rare").hidden = !(band && Badge.isRare(d.badge, band));
    const replaced = $("badge-popup-replaced");
    replaced.hidden = !d.replaced;
    if (d.replaced) replaced.textContent = `この場所の${NAMES[d.replaced] || "バッジ"}を上書きしました`;
    $("badge-popup").hidden = false;
    $("badge-popup-continue").focus();
  }

  function closePopup() {
    $("badge-popup").hidden = true;
  }

  function showError(message) {
    const el = $("survey-error");
    el.hidden = !message;
    el.textContent = message || "";
  }

  // 開発用：マイクの代わりの音（measure-test.html と同じ考え方）
  function makeSimulator(kind) {
    const base = kind === "quiet" ? 37 : 85;
    const t0 = performance.now();
    return () => {
      const t = (performance.now() - t0) / 1000;
      const noise = (Math.random() * 2 - 1) * (kind === "quiet" ? 1.5 : 3);
      return base + (kind === "quiet" ? 0 : 3 * Math.sin(t * 1.7)) + noise;
    };
  }
})();
