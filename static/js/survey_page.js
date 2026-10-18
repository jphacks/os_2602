/* ===========================================================================
   survey_page.js = 調査ページ（index.html）の画面の処理

   ▼ 役割の分け方
     測ること・サーバーに送ること … measure.js（DetherSurvey）。画面には触らない
     画面に描くこと               … このファイル。DetherSurvey のイベントを受け取って描くだけ
     イベントの中身は measure.js の先頭か docs/API_measurement.md を見る。

   ▼ バッジの見た目
     リーダーの部品 static/js/badge.js（DetherBadge）で作る。コード（b80 など）を渡すだけでよい。
   =========================================================================== */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ---------- 調整する数値はここだけ ---------- */
  const BAR_COUNT = 48; // 波形の本数
  const BAR_EVERY = 2; // level（100msごと）を何回受け取るたびに1本足すか。48本 × 200ms ≒ 10秒
  const RECENT_MAX = 3; // 「最近の記録」に出す件数（main/views.py の RECENT_COUNT と同じ）
  const WARNING_MS = 6000; // 85dBの案内を出しておく時間
  const POST_URL = "/api/posts"; // 投稿の送り先（main/api_posts.py）
  const MAX_PHOTO_MB = 15; // 写真の大きさの上限（main/api_posts.py の MAX_PHOTO_BYTES と同じ）

  const Badge = window.DetherBadge;
  const NAMES = Badge.NAMES;

  const MODE_TEXT = {
    normal: "調査中",
    loud: "大きい音を判定中",
    quiet: "静寂を判定中",
    deep: "深い静寂を判定中",
  };
  const STATE_TEXT = { starting: "準備中", paused: "一時停止中", interrupted: "中断中・押して再開" };
  const PLACE_KEY = "dether-indoor"; // 前回選んだ「屋外／屋内」を覚えておく（"1" なら屋内）

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
  const survey = new DetherSurvey({ indoor: loadIndoor() });

  /* ---------- 画面の部品 ---------- */
  const view = { idle: $("survey-idle"), live: $("survey-live") };
  const pill = $("live-pill");
  const pillStatus = $("live-status");
  const chip = $("gauge-chip");
  const wave = $("wave");
  const bars = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement("span");
    bar.style.height = "8%";
    wave.appendChild(bar);
    bars.push(bar);
  }

  // ゲージの中の砂の板。今の音の形に合わせて砂が動く（badge.js の plate）。測定中だけ動かす
  const sand = Badge.plate();
  document.querySelector(".gauge__well").prepend(sand.el);

  // いまの区間の最大値と、波形を足すタイミング
  let segMax = -Infinity;
  let lastElapsed = 0;
  let lastMode = "normal";
  let tick = 0;
  // 終わった区間の数。「◯回目」に使う。★送れたかどうかに関係なく、区間が終わるたびに増やす
  // （survey.sessionCount は送るのに成功した数。位置が取れない・通信の失敗では増えない）
  let roundsDone = 0;
  let warningTimer = null;
  // 投稿できる記録 rec = { measurementId, userBadgeId, badge, name, result, timeBand, row }
  //   popupRec   … 獲得ポップアップに出しているバッジの記録（投稿できないときは null）
  //   lastRecord … 直前の測定（調査中の「直前の音を投稿する」で使う）
  //   postTarget … 投稿シートで投稿しようとしている記録と、どこから開いたか（"popup" / "live"）
  let popupRec = null;
  let lastRecord = null;
  let postTarget = null;
  const postedIds = new Set(); // この画面で投稿した（送っている）測定の id

  // サーバーが描いた「最近の記録」のメダルを、押せるボタンに作り直す（中身は index.html の data-*）
  document.querySelectorAll("#recent-list [data-badge]").forEach((row) => {
    const old = row.querySelector(".medal");
    if (!old) return;
    const ds = row.dataset;
    old.replaceWith(recentMedal({
      badge: ds.badge,
      avgDb: Number(ds.avg),
      maxDb: Number(ds.max),
      at: ds.at,
      timeBand: ds.band ? { code: ds.band, name: ds.bandName } : null,
      spectrum: ds.spectrum ? ds.spectrum.split(",").map(Number) : null,
    }));
  });

  /* ---------- ボタン（★survey の操作は必ずボタンの処理の中で呼ぶ。iPhoneの決まり） ---------- */
  $("survey-start").addEventListener("click", () => {
    resetLive();
    showError("");
    survey.start();
  });
  $("survey-stop").addEventListener("click", () => survey.stop());

  // 屋外／屋内（始める前の切り替え）
  document.querySelectorAll(".place-switch__option").forEach((btn) => {
    btn.addEventListener("click", () => setIndoor(btn.dataset.indoor === "1"));
  });
  // 左上の表示：中断中なら再開、調査中なら屋外⇔屋内の切り替え（★survey の操作なのでボタンの処理の中で）
  pill.addEventListener("click", () => {
    if (survey.state === "interrupted") {
      survey.resume();
    } else if (survey.state === "measuring") {
      setIndoor(!survey.indoor);
      showMessage(`${survey.indoor ? "屋内" : "屋外"}に切り替えました。この区間は測り直します`, "info");
    }
  });
  $("survey-resume").addEventListener("click", () => survey.resume());
  // バッジ獲得のポップアップは、✕・背景・Esc のどれで閉じても調査を再開する（記録を見ているときは閉じるだけ）
  $("badge-popup-close").addEventListener("click", closePopup);
  $("badge-popup").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closePopup(); // シートの外（背景）を押したとき
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("post-sheet").hidden) postBack(); // 投稿シートは「戻る」と同じ
    else if (!$("badge-popup").hidden) closePopup();
  });

  // 投稿シート。★背景を押しても閉じない（書きかけの内容が消えないように）
  $("badge-popup-post").addEventListener("click", () => openPost(popupRec, "popup"));
  // 調査中の「直前の音を投稿する」。一時停止してから開く（★survey の操作なのでボタンの処理の中で）
  $("live-post").addEventListener("click", () => {
    if (!lastRecord || postedIds.has(lastRecord.measurementId)) return;
    survey.pause();
    openPost(lastRecord, "live");
  });
  $("post-back").addEventListener("click", postBack);
  $("post-form").addEventListener("submit", submitPost);
  document.querySelectorAll("#post-form .tag-chip").forEach((chipEl) => {
    chipEl.addEventListener("click", () => {
      chipEl.setAttribute("aria-pressed", String(chipEl.getAttribute("aria-pressed") !== "true"));
      $("post-submit").disabled = selectedTagIds().length === 0;
      showPostMedal();
    });
  });
  $("post-photo").addEventListener("change", showPhoto);
  $("post-photo-remove").addEventListener("click", () => {
    $("post-photo").value = "";
    showPhoto();
  });

  /* ---------- measure.js からのイベント ---------- */
  survey.on("state", (e) => {
    const state = e.detail.state;
    const running = state !== "idle" && state !== "stopped";
    view.idle.hidden = running;
    view.live.hidden = !running;
    pill.dataset.state = state;
    if (STATE_TEXT[state]) pillStatus.textContent = STATE_TEXT[state];
    showPlace();
    $("survey-resume").hidden = state !== "interrupted";
    if (state === "measuring") sand.start();
    else sand.stop(); // 一時停止中・中断中などは砂も止める（電池のため）
    if (!running) {
      $("guide").hidden = true;
      $("warning").hidden = true;
    }
  });

  survey.on("level", (e) => {
    const d = e.detail;
    const now = Number.isFinite(d.level) ? d.level : d.db;
    sand.setSpectrum(d.spectrum);

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
      `${roundsDone + 1}回目・${d.elapsed.toFixed(1)} / ${d.target} 秒`;
    $("live-avg").textContent = fmt1(d.segmentLeq);
    $("live-max").textContent = fmt1(segMax);

    if (survey.state === "measuring") {
      const text = MODE_TEXT[d.mode] || MODE_TEXT.normal;
      if (pillStatus.textContent !== text) {
        pillStatus.textContent = text;
        showPlace(); // 読み上げ用のラベルも合わせる
      }
      pill.dataset.mode = d.mode;
    }
    $("guide").hidden = !(d.guide && d.mode === "loud");

    tick += 1;
    if (tick % BAR_EVERY === 0) pushBar(now);
  });

  // 区間が終わった（判定つきでも通常でも）。送る前に必ず届く
  survey.on("round", () => {
    roundsDone += 1;
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
    const row = addRecent(d.result, d.badge, d.timeBand);
    remember(d, row);
  });

  survey.on("badge", (e) => {
    const d = e.detail;
    updateSession(d.result, d.name, d.badge);
    const row = addRecent(d.result, d.badge, d.timeBand);
    remember(d, row);
    openPopup(d, row);
  });

  survey.on("error", (e) => showError(e.detail.message));

  /* ---------- 屋外／屋内 ---------- */

  // localStorage はプライベートモードなどで使えないことがあるので、失敗したら屋外にする
  function loadIndoor() {
    try {
      return localStorage.getItem(PLACE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setIndoor(indoor) {
    survey.setIndoor(indoor); // 調査中なら、測りかけの区間は捨てて測り直す（measure.js）
    try {
      localStorage.setItem(PLACE_KEY, indoor ? "1" : "0");
    } catch {
      /* 覚えられなくても困らない */
    }
    showPlace();
  }

  // 始める前の切り替えと、調査中の左上の表示を、今の屋外／屋内に合わせる
  function showPlace() {
    const place = survey.indoor ? "屋内" : "屋外";
    document.querySelectorAll(".place-switch__option").forEach((btn) => {
      btn.setAttribute("aria-checked", String((btn.dataset.indoor === "1") === survey.indoor));
    });
    $("live-place").textContent = place;
    pill.dataset.indoor = survey.indoor ? "1" : "0";
    const label =
      survey.state === "interrupted"
        ? "中断中。押すと調査を再開します"
        : survey.state === "measuring"
          ? `${place}・${pillStatus.textContent}。押すと${survey.indoor ? "屋外" : "屋内"}に切り替えます`
          : `${place}・${pillStatus.textContent}`;
    pill.setAttribute("aria-label", label);
  }
  showPlace();

  /* ---------- 描画の道具 ---------- */

  function resetLive() {
    segMax = -Infinity;
    lastElapsed = 0;
    lastMode = "normal";
    tick = 0;
    roundsDone = 0;
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
    pillStatus.textContent = STATE_TEXT.starting;
    delete pill.dataset.mode;
    lastRecord = null;
    updateLivePost();
  }

  // 測定APIの返事から、投稿できる記録を作る（保存できなかった測定は投稿できないので null）
  function recordOf(d, row) {
    const res = d.response || {};
    const measurementId = res.measurement ? res.measurement.id : null;
    if (!measurementId) return null;
    return {
      measurementId,
      userBadgeId: res.badge ? res.badge.user_badge_id : null,
      badge: d.badge || null,
      name: d.badge ? NAMES[d.badge] : null,
      result: d.result,
      timeBand: d.timeBand,
      row,
    };
  }

  function remember(d, row) {
    lastRecord = recordOf(d, row);
    updateLivePost();
  }

  // 「直前の音を投稿する」の押せる・押せない と、下の説明
  function updateLivePost() {
    const rec = lastRecord;
    const posted = !!rec && postedIds.has(rec.measurementId);
    $("live-post").disabled = !rec || posted;
    $("live-post-label").textContent = posted ? "投稿しました" : "直前の音を投稿する";
    $("live-post-note").textContent = rec
      ? `直前：${fmt1(rec.result.avgDb)} dB・${rec.name || "バッジなし"}`
      : "測定が1回終わると投稿できます";
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
    if (newBadge) $("session-badge").replaceChildren(Badge.medal(newBadge, "list", { spectrum: result.spectrum }));
  }

  // 「最近の記録」の先頭に1行足す（タグは後から付けるので、ここではバッジ名）
  // バッジの無い記録は「タグなし」になるので足さない（main/views.py の index() と同じ）
  function addRecent(result, badge, timeBand) {
    if (!badge) return null;
    const row = $("recent-row").content.firstElementChild.cloneNode(true);
    const slot = (name) => row.querySelector(`[data-slot="${name}"]`);
    const at = result.endedAt;
    slot("db").textContent = fmt1(result.avgDb);
    slot("title").textContent = NAMES[badge];
    slot("meta").textContent =
      `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, "0")}:` +
      `${String(at.getMinutes()).padStart(2, "0")}` + (timeBand ? `・${timeBand.name}` : "");
    slot("badge").replaceWith(recentMedal({
      badge,
      avgDb: result.avgDb,
      maxDb: result.maxDb,
      at: slot("meta").textContent.split("・")[0],
      timeBand,
      spectrum: result.spectrum,
    }));

    const list = $("recent-list");
    list.prepend(row);
    while (list.children.length > RECENT_MAX) list.lastElementChild.remove();
    $("recent-empty").hidden = true;
    return row;
  }

  // バッジの無い記録を投稿したとき、「最近の記録」の先頭にタグのメダルで1行足す
  function addTagRecent(rec, tag, tagNames) {
    const row = $("recent-row").content.firstElementChild.cloneNode(true);
    const slot = (name) => row.querySelector(`[data-slot="${name}"]`);
    const at = rec.result.endedAt;
    slot("db").textContent = fmt1(rec.result.avgDb);
    slot("title").textContent = tagNames.join("・");
    slot("meta").textContent =
      `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, "0")}:` +
      `${String(at.getMinutes()).padStart(2, "0")}` + (rec.timeBand ? `・${rec.timeBand.name}` : "");
    slot("badge").replaceWith(Badge.tagMedal(tag, "md", { spectrum: rec.result.spectrum }));

    const list = $("recent-list");
    list.prepend(row);
    while (list.children.length > RECENT_MAX) list.lastElementChild.remove();
    $("recent-empty").hidden = true;
  }

  // 「最近の記録」のメダル。押すと、獲得ポップアップと同じ形でその記録を見せる
  // rec = { badge, avgDb, maxDb, at（"10/17 18:32"）, timeBand（{ code, name } か null）, spectrum }
  function recentMedal(rec) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent__badge";
    button.setAttribute("aria-label", `${NAMES[rec.badge]}の記録を見る`);
    button.append(Badge.medal(rec.badge, "md", { band: rec.timeBand && rec.timeBand.code, spectrum: rec.spectrum }));
    button.addEventListener("click", () => openRecord(rec));
    return button;
  }

  // 記録を見る（調査していないときだけ押せる）。閉じても調査は始めない
  function openRecord(rec) {
    const band = rec.timeBand ? rec.timeBand.code : null;
    $("badge-popup").dataset.mode = "view";
    $("badge-popup-close").setAttribute("aria-label", "閉じる");
    $("badge-popup-kicker").textContent = `${rec.at} の記録`;
    $("badge-popup-medal").replaceChildren(Badge.medal(rec.badge, "popup", { isNew: true, band, spectrum: rec.spectrum }));
    $("badge-popup-title").textContent = NAMES[rec.badge];
    const bandName = rec.timeBand ? rec.timeBand.name : "";
    const rare = band && Badge.isRare(rec.badge, band) ? "（レア）" : "";
    $("badge-popup-note").textContent = bandName ? `${bandName}のバッジ${rare}` : "";
    $("badge-popup-replaced").hidden = true;
    $("badge-popup-avg").textContent = fmt1(rec.avgDb);
    $("badge-popup-max").textContent = fmt1(rec.maxDb);
    $("badge-popup-band").textContent = bandName || "--";
    popupRec = null;
    $("badge-popup-post").hidden = true;

    $("badge-popup").hidden = false;
    $("badge-popup-close").focus();
  }

  function openPopup(d, row) {
    delete $("badge-popup").dataset.mode;
    $("badge-popup-close").setAttribute("aria-label", "閉じて調査を再開");
    $("badge-popup-kicker").textContent = "バッジ獲得";
    const band = d.timeBand ? d.timeBand.code : null; // "d"（昼）/ "n"（夜）
    // ★開くたびに作り直す。そうすると獲得の演出（ポンと出て光が走る）が毎回再生される
    // 数字の後ろの面に、その場の音の形（音の標本）を描く
    $("badge-popup-medal").replaceChildren(Badge.medal(d.badge, "popup", { isNew: true, band, spectrum: d.result.spectrum }));
    $("badge-popup-title").textContent = d.name;
    const bandName = d.timeBand ? d.timeBand.name : "";
    // 企画書：昼の静寂・深い静寂と夜の90dBはレア（判定は badge.js）
    const rare = band && Badge.isRare(d.badge, band) ? "（レア）" : "";
    $("badge-popup-note").textContent = bandName
      ? `${bandName}のバッジとして地図に記録しました${rare}`
      : "地図に記録しました";
    const replaced = $("badge-popup-replaced");
    replaced.hidden = !d.replaced;
    if (d.replaced) replaced.textContent = `この場所の${NAMES[d.replaced] || "バッジ"}を上書きしました`;

    $("badge-popup-avg").textContent = fmt1(d.result.avgDb);
    $("badge-popup-max").textContent = fmt1(d.result.maxDb);
    $("badge-popup-band").textContent = bandName || "--";
    // 投稿できるのは、サーバーに保存できた記録だけ
    popupRec = recordOf(d, row);
    $("badge-popup-post").hidden = !popupRec;

    $("badge-popup").hidden = false;
    $("badge-popup-close").focus();
  }

  // ★survey.resume() はボタンやキーの処理の中で呼ぶ（iPhoneはそうしないとマイクが再開しない）
  function closePopup() {
    $("badge-popup").hidden = true;
    if ($("badge-popup").dataset.mode !== "view") survey.resume();
  }

  /* ---------- 投稿シート ---------- */

  // rec … 投稿する記録 / from … "popup"（獲得ポップアップから）か "live"（調査中のボタンから）
  function openPost(rec, from) {
    if (!rec) return;
    postTarget = { rec, from };
    $("post-sub").textContent = [rec.name || "バッジなし", rec.timeBand && rec.timeBand.name, `${fmt1(rec.result.avgDb)} dB`]
      .filter(Boolean)
      .join("・");

    // 前に開いたときの入力を消す
    $("post-form").reset();
    document.querySelectorAll("#post-form .tag-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    $("post-submit").disabled = true;
    showPostMedal();
    showPhoto();
    postError("");

    $("badge-popup").hidden = true;
    $("post-sheet").hidden = false;
    $("post-sheet").querySelector(".post-sheet__body").scrollTop = 0;
    $("post-back").focus();
  }

  // 投稿シートの左上のメダル。バッジがあればそのバッジ、無ければ選んだ1つ目のタグのメダル
  // （まだ選んでいないときは dB の数字のメダル）。どれも、その音の模様入り
  function showPostMedal() {
    if (!postTarget) return;
    const rec = postTarget.rec;
    const opt = { band: rec.timeBand && rec.timeBand.code, spectrum: rec.result.spectrum };
    if (rec.badge) {
      $("post-medal").replaceChildren(Badge.medal(rec.badge, "list", opt));
      return;
    }
    const first = document.querySelector('#post-form .tag-chip[aria-pressed="true"]');
    const tag = first
      ? { name: tagName(first), icon: first.dataset.icon, color: first.dataset.color }
      : { name: "直前の音", icon: String(Math.round(rec.result.avgDb)), color: "sage" };
    $("post-medal").replaceChildren(Badge.tagMedal(tag, "list", opt));
  }

  // 「戻る」：獲得ポップアップから来たら戻る。調査中のボタンから来たら閉じて調査を再開する
  function postBack() {
    $("post-sheet").hidden = true;
    if (postTarget && postTarget.from === "popup") {
      $("badge-popup").hidden = false;
      $("badge-popup-post").focus();
    } else {
      survey.resume(); // ★ボタンやキーの処理の中で呼ぶ（iPhone の決まり）
      $("live-post").focus();
    }
    postTarget = null;
  }

  const tagName = (chipEl) => chipEl.lastChild.textContent.trim();

  function selectedTagIds() {
    return [...document.querySelectorAll('#post-form .tag-chip[aria-pressed="true"]')].map(
      (c) => c.dataset.tagId
    );
  }

  // 選んだ写真を小さく見せる。大きすぎる写真はここで外す
  let photoUrl = null;
  function showPhoto() {
    const file = $("post-photo").files[0];
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    if (file && file.size > MAX_PHOTO_MB * 1024 * 1024) {
      $("post-photo").value = "";
      postError(`写真が大きすぎます（${MAX_PHOTO_MB}MBまで）`);
      return showPhoto();
    }
    if (file) {
      photoUrl = URL.createObjectURL(file);
      $("post-photo-img").src = photoUrl;
      postError("");
    }
    $("post-photo-preview").hidden = !file;
    $("post-photo-pick").hidden = !!file;
  }

  function postError(message) {
    $("post-error").hidden = !message;
    $("post-error").textContent = message || "";
  }

  // ★送り終わるのを待たずに、押した瞬間に調査を再開する。
  //   survey.resume() はボタンの処理の中で呼ばないと、iPhone でマイクが再開しないため。
  //   送った結果は、画面上のお知らせ（main.js の showMessage）で伝える。
  function submitPost(e) {
    e.preventDefault();
    const rec = postTarget && postTarget.rec;
    const tagIds = selectedTagIds();
    if (!rec || !tagIds.length) {
      postError("何の音だったか、タグを1つ以上選んでください");
      return;
    }

    const form = new FormData();
    // バッジがあればバッジの投稿、無ければ測定の投稿（main/api_posts.py）
    if (rec.userBadgeId) form.append("user_badge_id", rec.userBadgeId);
    else form.append("measurement_id", rec.measurementId);
    tagIds.forEach((id) => form.append("tag_ids", id));
    form.append("description", $("post-description").value.trim());
    const photo = $("post-photo").files[0];
    if (photo) form.append("photo", photo);

    // 「最近の記録」の行のタイトルを、選んだタグにする（index() がタグを先に出すのと同じ）
    const chosen = [...document.querySelectorAll('#post-form .tag-chip[aria-pressed="true"]')];
    const tagNames = chosen.map(tagName);
    const firstTag = { name: tagNames[0], icon: chosen[0].dataset.icon, color: chosen[0].dataset.color };
    const row = rec.row;

    postTarget = null;
    if (rec === popupRec) popupRec = null;
    postedIds.add(rec.measurementId); // 二重に送らないよう、返事を待たずに「投稿済み」にする
    updateLivePost();
    $("post-sheet").hidden = true;
    survey.resume();

    fetch(POST_URL, {
      method: "POST",
      body: form, // ★Content-Type は書かない（写真を送る形をブラウザが付ける）
      headers: { Accept: "application/json", "X-CSRFToken": CSRF_TOKEN }, // CSRF_TOKEN は main.js
      credentials: "same-origin",
    })
      .then(handleResponse) // main.js。失敗ならサーバーの文言でエラーにする
      .then(() => {
        showMessage("投稿しました。マップに載りました", "success");
        const title = row && row.querySelector('[data-slot="title"]');
        if (title) title.textContent = tagNames.join("・");
        else if (!rec.badge) addTagRecent(rec, firstTag, tagNames); // バッジの無い記録は、ここで初めて足す
      })
      .catch((err) => {
        postedIds.delete(rec.measurementId); // もう一度投稿できるように戻す
        updateLivePost();
        showMessage(`投稿できませんでした：${err.message}`, "error");
      });
  }

  function showError(message) {
    const el = $("survey-error");
    el.hidden = !message;
    el.textContent = message || "";
  }
})();
