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

  /* ---------- 音の標本（クラドニ図形） ----------
     振動する板に砂をまくと、揺れない線（節）に砂が集まって模様ができる（クラドニ図形）。
     その場の音の形（16の帯の強さ）から板の揺れ方を決め、砂粒を節へ集めて描く。
       ・帯ごとに振動の型（n, m）を割り当てる。低音は大きな模様、高音は細かい模様（本物の板と同じ）
       ・強かった上位3つの帯の型を、強さに応じて重ね合わせる → 場所ごとに違う模様になる
       ・同じ音の形なら、いつ描いても同じ模様（砂のまき方を音の形から決めている）
     色はメダルの文字色を使うので、明るい面でも暗い面でも見える。 */
  const CHLADNI_MODES = [
    [1, 2], [1, 3], [2, 3], [1, 4], [2, 4], [3, 4], [1, 5], [2, 5],
    [3, 5], [4, 5], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [3, 7],
  ];
  const MEDAL_PX = { popup: 120, list: 48, pin: 44, md: 34, sm: 32, xs: 28, xxs: 26 };
  const SPECIMEN_RATE = 0.56; // 模様を描く円の直径（メダルに対する割合。badge.css の .medal__specimen と同じ）
  // サイズごとの [砂粒の数, 砂粒の大きさ(px)]
  const SAND = {
    popup: [2600, 1.3], list: [800, 1], pin: [720, 1], md: [420, 0.9],
    sm: [380, 0.9], xs: [320, 0.8], xxs: [280, 0.8],
  };
  // サイズごとに、板のどこまでを見せるか（1 = 板全体）。小さいメダルで全体を描くと線が詰まって潰れるので、
  // 中央を拡大して見せる（同じ音なら、大きいメダルの模様の真ん中と同じ形になる）
  const VIEW = { popup: 1, list: 0.7, pin: 0.7, md: 0.5, sm: 0.5, xs: 0.5, xxs: 0.5 };
  const SETTLE_STEPS = 45; // 砂が模様にまとまるまでの回数（獲得演出では1回＝1コマ、約0.8秒）

  /** 音の形 → 板の揺れの大きさ f(x, y)。x, y は -1〜1。f = 0 のところが節（砂が集まる線）
      view は板のどこまでを見せるか（VIEW）。1 より小さいと中央を拡大する */
  function chladniField(spectrum, view) {
    const z = view || 1;
    const top = spectrum
      .map((v, i) => [Number(v) || 0, i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3)
      .filter((b) => b[0] > 0.05);
    const modes = top.map(([v, i]) => {
      const [n, m] = CHLADNI_MODES[i % CHLADNI_MODES.length];
      // 帯ごとに重ね方の向き（＋／−）を変える。全部「−」だと、どの音でも対角線に同じ×が出てしまうため
      return { n: n * Math.PI * z, m: m * Math.PI * z, a: v * v, sign: i % 2 === 0 ? -1 : 1 };
    });
    if (!modes.length) modes.push({ n: Math.PI * z, m: 2 * Math.PI * z, a: 1, sign: -1 });
    return function (x, y) {
      let f = 0;
      for (const d of modes) {
        f += d.a * (Math.cos(d.n * x) * Math.cos(d.m * y) + d.sign * Math.cos(d.m * x) * Math.cos(d.n * y));
      }
      return f;
    };
  }

  /** 同じ値からは同じ並びを返す乱数（砂のまき方を音の形で決めるため） */
  function seededRandom(spectrum) {
    let s = spectrum.reduce((h, v, i) => (h * 31 + Math.round((Number(v) || 0) * 100) + i) | 0, 7) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  /** 砂粒を1回動かす：節（f = 0）へ寄せ、揺れの大きいところでは跳ねさせる */
  function settle(points, f, rand) {
    const h = 0.01;
    for (const p of points) {
      const x = p[0], y = p[1];
      const v = f(x, y);
      const gx = (f(x + h, y) - f(x - h, y)) / (2 * h);
      const gy = (f(x, y + h) - f(x, y - h)) / (2 * h);
      const g2 = gx * gx + gy * gy + 1e-6;
      let dx = (-0.6 * v * gx) / g2;
      let dy = (-0.6 * v * gy) / g2;
      const len = Math.hypot(dx, dy);
      if (len > 0.08) { dx *= 0.08 / len; dy *= 0.08 / len; } // 一度に飛びすぎない
      // 揺れの大きいところほど強く跳ねる。少しだけは常に揺らして、線に砂らしい太さを残す
      const shake = Math.min(0.05, Math.abs(v) * 0.02 + 0.012);
      let nx = x + dx + (rand() * 2 - 1) * shake;
      let ny = y + dy + (rand() * 2 - 1) * shake;
      const r = Math.hypot(nx, ny);
      if (r > 0.98) { nx *= 0.98 / r; ny *= 0.98 / r; } // 円の外に出さない
      p[0] = nx;
      p[1] = ny;
    }
  }

  /**
   * 音の形 → クラドニ図形を描いたキャンバス
   * @param {number[]} spectrum  0〜1 の配列（低音→高音）
   * @param {string}   size      メダルのサイズ（砂粒の数と大きさが変わる）
   * @param {boolean}  [animate] true なら、ばらばらの砂が模様にまとまっていく様子を見せる
   */
  function specimen(spectrum, size, animate) {
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const side = Math.max(8, Math.round((MEDAL_PX[size] || 48) * SPECIMEN_RATE * dpr));
    const [count, dot] = SAND[size] || SAND.list;
    const canvas = document.createElement("canvas");
    canvas.className = "medal__specimen"; // 位置と濃さは badge.css
    canvas.width = canvas.height = side;
    canvas.setAttribute("aria-hidden", "true");

    const f = chladniField(spectrum, VIEW[size]);
    const rand = seededRandom(spectrum);
    const points = [];
    for (let k = 0; k < count; k++) { // 円の中に均一にまく
      const r = Math.sqrt(rand()), t = rand() * 2 * Math.PI;
      points.push([r * Math.cos(t), r * Math.sin(t)]);
    }

    const paint = () => {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, side, side);
      ctx.fillStyle = getComputedStyle(canvas).color || "#243B35"; // メダルの文字色
      const s = dot * dpr;
      for (const p of points) ctx.fillRect(((p[0] + 1) / 2) * side - s / 2, ((p[1] + 1) / 2) * side - s / 2, s, s);
    };

    const reduceMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let tries = 0;
    let step = 0;
    const frame = () => {
      // 画面に入るまで待つ（文字色が分からないため）
      if (!canvas.isConnected) {
        if (++tries < 120) global.requestAnimationFrame(frame);
        return;
      }
      if (animate && !reduceMotion) {
        settle(points, f, rand);
        paint();
        if (++step < SETTLE_STEPS) global.requestAnimationFrame(frame);
      } else {
        for (let i = 0; i < SETTLE_STEPS; i++) settle(points, f, rand);
        paint();
      }
    };
    global.requestAnimationFrame(frame);
    return canvas;
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
   * @param {number[]} [opt.spectrum]     音の形（0〜1 の配列。低音→高音。measure.js の result.spectrum）。
   *                                      渡すと、数字の後ろの面に「音の標本」（クラドニ図形）を描く。
   *                                      isNew のときは、砂が模様にまとまっていく様子も見せる
   */
  function medal(code, size, opt) {
    check(code);
    const o = opt || {};
    const s = SIZES.includes(size) ? size : "list";
    const el = document.createElement("span");
    el.className = `medal ${o.locked ? "m-lock" : "m-" + code} medal--${s}`;
    if (code[0] === "q") el.classList.add("medal--kanji");   // 静・深は明朝体
    if (o.spectrum && o.spectrum.length >= 3 && !o.locked) {
      // 模様を数字の後ろ・面の上に重ねるため、数字も要素に入れて重なり順を決める（badge.css）
      el.append(specimen(o.spectrum, s, !!o.isNew));
      const mark = document.createElement("span");
      mark.className = "medal__mark";
      mark.textContent = MARK[code];
      el.append(mark);
    } else {
      el.textContent = MARK[code];
    }
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

  global.DetherBadge = { CODES, MARK, NAMES, RARE, BAND, isRare, medal, pin, setPinSelected, row, codeFromBadgeType, specimen };
})(window);
