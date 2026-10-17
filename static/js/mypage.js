/* ===========================================================================
   mypage.js = マイページ（mypage.html）の画面の処理

   ▼ やること
     1. カードのメダルに「音の標本」（その音から描く模様）を描く
        テンプレートのメダル（badge.html）は模様を描けないので、一番新しい標本で描き直す
     2. 「集めたバッジ」の絞り込み（すべて／昼／夜）
        行の data-band が時間帯のID、data-count が個数。右上の「合計」も出している分の合計にする
     3. カードを押すと「図鑑のシート」を開く。説明と、これまでの標本を並べる
        上の大きなバッジは、開いたときは模様なし。下の標本を押すと、その標本の模様で描き直す
        （もう一度押すと模様なしに戻る）

   ▼ データ
     main/views.py の mypage() が作った zukan_data（ページの <script id="zukan-data">）。
     キーはカードの data-key（dBバッジは "b-b80-1"、タグは "t-3"）。
   =========================================================================== */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const Badge = window.DetherBadge;
  const dataEl = $("zukan-data");
  const DATA = dataEl ? JSON.parse(dataEl.textContent) : {};

  /* ---------- 1. カードのメダルに音の模様を描く ---------- */
  document.querySelectorAll("[data-medal]").forEach((slot) => {
    const entry = DATA[slot.dataset.medal];
    const latest = entry && entry.items.find((it) => it.spectrum);
    if (!latest) return; // まだ取っていない・模様の材料が無い（模様ができる前の記録）
    slot.replaceChildren(medalOf(entry, "md", { band: entry.band, spectrum: latest.spectrum }));
  });

  // 図鑑の1つ分のメダル。dBバッジはバッジのメダル、タグはタグのメダル（色はタグごと）
  function medalOf(entry, size, opt) {
    return entry.kind === "tag"
      ? Badge.tagMedal(entry.tag, size, opt)
      : Badge.medal(entry.code, size, opt);
  }

  /* ---------- 2. 時間帯の絞り込み ---------- */
  const tabs = document.querySelectorAll(".band-tabs__tab");
  const cards = document.querySelectorAll(".badge-card");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const band = tab.dataset.band;
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));

      let total = 0;
      let shown = 0;
      cards.forEach((card) => {
        const show = band === "all" || card.dataset.band === band;
        card.hidden = !show;
        if (show) {
          total += Number(card.dataset.count);
          shown += 1;
        }
      });
      $("badge-sum").textContent = String(total);
      $("badge-empty").hidden = shown > 0;
    });
  });

  /* ---------- 3. 図鑑のシート ---------- */
  const sheet = $("zukan-sheet");
  let opener = null; // 閉じたら、押したカードに戻る
  let current = null; // 開いている図鑑の中身（zukan_data の1つ）

  document.querySelectorAll(".zukan__item[data-key]").forEach((btn) => {
    btn.addEventListener("click", () => openZukan(btn));
  });
  $("zukan-sheet-close").addEventListener("click", closeZukan);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) closeZukan(); // シートの外（背景）を押したとき
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) closeZukan();
  });

  function openZukan(btn) {
    const d = DATA[btn.dataset.key];
    if (!d) return;
    opener = btn;
    current = d;
    const got = d.count > 0;
    showHero(null);

    $("zukan-sheet-no").textContent = d.number ? `No.${String(d.number).padStart(3, "0")}` : "";
    $("zukan-sheet-title").textContent = d.title;
    $("zukan-sheet-chips").replaceChildren(
      ...d.chips.map((text) => {
        const chip = document.createElement("span");
        chip.className = text === "レア！" ? "chip chip--rare" : "chip";
        chip.textContent = text;
        return chip;
      })
    );
    $("zukan-sheet-count").textContent = got
      ? `${d.count}回 ${d.kind === "badge" ? "獲得" : "出会った"}`
      : "まだ出会っていません";

    const text = $("zukan-sheet-text");
    text.textContent = got ? d.text : `ヒント：${d.text}`;
    text.classList.toggle("zukan-sheet__text--hint", !got);

    $("zukan-sheet-items").replaceChildren(...d.items.map((it) => specimenItem(it, d)));
    $("zukan-sheet-empty").hidden = d.items.length > 0;

    sheet.hidden = false;
    sheet.querySelector(".zukan-sheet__scroll").scrollTop = 0;
    $("zukan-sheet-close").focus();
  }

  function closeZukan() {
    sheet.hidden = true;
    if (opener) opener.focus();
  }

  /**
   * 上の大きなメダルを描く。item が null なら模様なし（開いたとき）、標本なら その模様で描く
   *   dBバッジはバッジのメダル、タグはタグのメダル
   */
  function showHero(item) {
    const d = current;
    const got = d.count > 0;
    const visual = $("zukan-sheet-visual");
    const picked = $("zukan-sheet-picked");

    if (item) {
      // ★作り直すと、砂が模様にまとまっていく演出（isNew）が毎回再生される
      visual.replaceChildren(medalOf(d, "popup", { band: item.band, spectrum: item.spectrum, isNew: true }));
    } else {
      visual.replaceChildren(medalOf(d, "popup", { band: d.band, locked: !got }));
    }

    picked.hidden = !item;
    picked.textContent = item ? `${item.at}・${item.avg_db.toFixed(1)} dB の音` : "";
  }

  // 標本1つ分：模様入りのメダルと、日時・dB。押すと上に大きく出す
  function specimenItem(it, d) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "specimen";
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", `${it.at}・${it.avg_db.toFixed(1)} dB の標本を大きく見る`);
    btn.append(medalOf(d, "list", { band: it.band, spectrum: it.spectrum }));
    const db = document.createElement("span");
    db.className = "specimen__db num";
    db.textContent = `${it.avg_db.toFixed(1)} dB`;
    const at = document.createElement("span");
    at.className = "specimen__at num";
    at.textContent = it.at;
    btn.append(db, at);
    if (it.tags.length) btn.title = it.tags.join("・");

    btn.addEventListener("click", () => {
      const on = btn.getAttribute("aria-pressed") !== "true";
      $("zukan-sheet-items")
        .querySelectorAll(".specimen")
        .forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", String(on));
      showHero(on ? it : null);
      // 上のバッジが見えるところまで戻す
      if (on) sheet.querySelector(".zukan-sheet__scroll").scrollTo({ top: 0, behavior: "smooth" });
    });
    li.append(btn);
    return li;
  }
})();
