/* ==========================================================================
   dether バッジ（メダル）部品  static/js/badge.js
   --------------------------------------------------------------------------
   画面側で使う、メダル要素を作る関数。コード・表示文字・名前・レアの判定は
   フロントプロトタイプ（Main.dc.html）の MARK / NAMES / RARE と同じ。

     // 獲得ポップアップ（isNew で演出つき。開くたびに作り直すと毎回再生される）
     popupEl.replaceChildren(DetherBadge.medal("b80", "popup", { isNew: true }));

     // マップのピン（Google Maps の AdvancedMarkerElement にそのまま渡す）
     new google.maps.marker.AdvancedMarkerElement({
       map, position, content: DetherBadge.pin("b90", { count: 2 }),
     });

     // マイページの1行
     rowEl.replaceWith(DetherBadge.row("d", ["b80", "b70"]));
   ========================================================================== */
(function (global) {
  "use strict";

  const CODES = ["b90", "b80", "b70", "q40", "q35"];            // マイページの並び順
  const MARK  = { b90: "90", b80: "80", b70: "70", q40: "静", q35: "深" };
  const NAMES = { b90: "90dBバッジ", b80: "80dBバッジ", b70: "70dBバッジ", q40: "静寂バッジ", q35: "深い静寂バッジ" };
  const RARE  = { q40d: true, q35d: true, b90n: true };        // 昼の静寂・昼の深い静寂・夜の90dB
  const BAND  = { d: "昼", n: "夜" };
  const SIZES = ["popup", "list", "pin", "md", "sm", "xs", "xxs"];

  function check(code) {
    if (!MARK[code]) throw new Error(`DetherBadge: 未知のコード "${code}"`);
  }

  /** レアかどうか（band は "d" = 昼 / "n" = 夜） */
  function isRare(code, band) {
    return !!RARE[code + band];
  }

  /**
   * メダルを1つ作る
   * @param {string} code    "b90" | "b80" | "b70" | "q40" | "q35"
   * @param {string} [size]  "popup" | "list" | "pin" | "md" | "sm" | "xs" | "xxs"（既定 "list"）
   * @param {Object} [opt]
   * @param {boolean} [opt.locked=false]  未獲得の見た目にする（文字は残る。マイページと同じ）
   * @param {string}  [opt.band]          "d" | "n"（読み上げ用のラベルに使う）
   * @param {boolean} [opt.isNew=false]   獲得演出（ポンと出て光が走る）
   */
  function medal(code, size, opt) {
    check(code);
    const o = opt || {};
    const s = SIZES.includes(size) ? size : "list";
    const el = document.createElement("span");
    el.className = `medal ${o.locked ? "m-lock" : "m-" + code} medal--${s}`;
    if (code[0] === "q") el.classList.add("medal--kanji");   // 静・深は明朝体
    el.textContent = MARK[code];
    if (o.isNew) {
      el.classList.add("medal--new");
      const shine = document.createElement("span");
      shine.className = "medal__shine";
      shine.setAttribute("aria-hidden", "true");
      el.append(shine);
    }
    el.dataset.code = code;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label",
      `${o.band ? BAND[o.band] + "の" : ""}${NAMES[code]}${o.locked ? "（未獲得）" : ""}`);
    return el;
  }

  /**
   * マップのピン（モックの .pin ＋ .pin-count）
   * AdvancedMarkerElement は content の下端中央を地点に合わせるので、
   * メダルの中心が地点に来るよう外側の要素を半分下げている。
   * @param {string} code
   * @param {Object} [opt]
   * @param {number}  [opt.count]     同じ場所のバッジ件数（2以上で右上に表示）
   * @param {boolean} [opt.selected]  選択中の見た目
   * @param {string}  [opt.label]     読み上げ用ラベル（省略時はバッジ名）
   * @param {Function}[opt.onClick]
   */
  function pin(code, opt) {
    check(code);
    const o = opt || {};
    const wrap = document.createElement("div");
    wrap.style.transform = "translateY(50%)";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pin";
    btn.setAttribute("aria-pressed", o.selected ? "true" : "false");
    btn.setAttribute("aria-label", o.label || NAMES[code] + (o.count > 1 ? `ほか${o.count - 1}件` : ""));
    const m = medal(code, "pin");
    m.removeAttribute("role");
    m.setAttribute("aria-hidden", "true");
    btn.append(m);

    if (o.count && o.count > 1) {
      const c = document.createElement("span");
      c.className = "pin-count";
      c.textContent = String(o.count);
      c.setAttribute("aria-hidden", "true");
      btn.append(c);
    }
    if (o.onClick) btn.addEventListener("click", o.onClick);
    wrap.append(btn);
    return wrap;
  }

  /** ピンの選択状態を切り替える */
  function setPinSelected(pinWrap, selected) {
    const btn = pinWrap.querySelector(".pin");
    if (btn) btn.setAttribute("aria-pressed", selected ? "true" : "false");
  }

  /**
   * マイページ「バッジ（昼夜10種）」の1行（5個）
   * @param {"d"|"n"} band
   * @param {string[]} earnedCodes  その時間帯で獲得済みのコード（例: ["b80", "b70"]）
   */
  function row(band, earnedCodes) {
    const got = new Set(earnedCodes || []);
    const r = document.createElement("div");
    r.className = "medal-row";
    CODES.forEach((code) => {
      const item = document.createElement("div");
      item.className = "medal-item";
      item.append(medal(code, "list", { locked: !got.has(code), band }));

      const name = document.createElement("span");
      name.className = "medal-item__name";
      name.textContent = NAMES[code].replace("バッジ", "");
      item.append(name);

      if (isRare(code, band)) {
        const rare = document.createElement("span");
        rare.className = "medal-rare";
        rare.textContent = "レア";
        item.append(rare);
      }
      r.append(item);
    });
    return r;
  }

  /**
   * DBの BadgeType からコードを決める（BadgeType に列を足さずに済む）
   * category: "loud" → threshold_db で b90 / b80 / b70
   * category: "silence" → threshold_db が35以下なら q35、それ以外 q40
   *   ★秒数では分けない。測定の決まりでは静寂も深い静寂も15秒（models.py の BadgeType.code と同じ）
   */
  function codeFromBadgeType(bt) {
    if (bt.category === "loud") return "b" + Math.round(Number(bt.threshold_db));
    if (bt.category === "silence") return Number(bt.threshold_db) <= 35 ? "q35" : "q40";
    throw new Error(`DetherBadge: 未知の category "${bt.category}"`);
  }

  global.DetherBadge = { CODES, MARK, NAMES, RARE, BAND, isRare, medal, pin, setPinSelected, row, codeFromBadgeType };
})(window);
