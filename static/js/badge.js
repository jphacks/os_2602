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

     // タグのメダル（音の図鑑など）。tag はサーバーの Tag.medal と同じ { name, icon, color }
     el.replaceChildren(DetherBadge.tagMedal({ name: "祭り", icon: "祭", color: "shu" }, "list", { spectrum }));

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
  // タグのメダルの色の組（badge.css の .m-tag-○○。main/models.py の Tag.MedalColor と同じ）
  // legend はレジェンドバッジ（決められたタグを全部集めると解放。main/legend_data.py）の金色
  const TAG_COLORS = ["sage", "moss", "ai", "shu", "yamabuki", "fuji", "sakura", "sumi", "legend"];
  const SIZES = ["popup", "list", "pin", "md", "sm", "xs", "xxs"];

  function check(code) {
    if (!MARK[code]) throw new Error(`DetherBadge: 未知のコード "${code}"`);
  }

  /* ---------- 音の標本（クラドニ図形） ----------
     振動する板に砂をまくと、揺れない線（節）に砂が集まって模様ができる（クラドニ図形）。
     その場の音の形（16の帯の強さ）から板の揺れ方を決め、砂粒を節へ集めて描く。
       ・街の音はどこでも低音ほど強いので、その傾きを差し引いてから「この場所らしい音」を見る
       ・音の形の特徴から、振動の型（縦と横の波の数）を連続的に決める → 音が少し違えば模様も少し違う
           重心（高めか低めか）→ 波の数。高い音ほど細かい模様（本物の板と同じ）
           広がり（いろいろな高さが混ざっているか）→ 縦と横の波の数の差
           低音と高音の比 → 2つの向きの重ね方
           一番目立つ帯 → 2つ目の模様を重ねる（目立つほど強く）
       ・同じ音の形なら、いつ描いても同じ模様（砂のまき方を音の形から決めている）
     色はメダルの文字色を使うので、明るい面でも暗い面でも見える。 */
  const SPECTRUM_RANGE_DB = 40; // 音の形の 0〜1 が何dBぶんか（measure.js の spectrumRangeDb と同じ）
  const TILT_DB_PER_BAND = 1.2; // 差し引く低音の偏り（帯1つ上がるごとに何dB弱いのが普通か）
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
    const last = spectrum.length - 1;

    // 1. 低音の偏りを差し引いて、帯ごとの強さの割合 p にする（0 の帯＝聞こえなかった帯は数えない）
    const w = spectrum.map((v, b) => {
      v = Number(v) || 0;
      return v > 0 ? Math.pow(10, ((v - 1) * SPECTRUM_RANGE_DB + TILT_DB_PER_BAND * b) / 10) : 0;
    });
    const total = w.reduce((a, v) => a + v, 0) || 1;
    const p = w.map((v) => v / total);

    // 2. 音の形の特徴
    let centroid = 0; // 重心 0（低い）〜1（高い）
    p.forEach((v, b) => { centroid += v * (b / last); });
    let spread = 0; // 広がり 0（1つの高さだけ）〜1（いろいろ混ざる）
    p.forEach((v, b) => { spread += v * Math.pow(b / last - centroid, 2); });
    spread = Math.min(1, Math.sqrt(spread) / 0.3);
    let tilt = 0; // 高音の割合 − 低音の割合（-1〜1）
    p.forEach((v, b) => { tilt += b < spectrum.length / 2 ? -v : v; });
    let peak = 0; // 一番目立つ帯
    p.forEach((v, b) => { if (v > p[peak]) peak = b; });

    // 3. 特徴 → 振動の型
    const n = 1 + centroid * 2.5;
    const m = n + 1 + spread * 2;
    const k = Math.max(-1, Math.min(1, tilt * 1.5)); // 2つの向きの重ね方
    const n2 = 1 + (peak / last) * 2.5;
    const m2 = n2 + 1;
    const a2 = 0.8 * p[peak]; // 目立つ帯が強いほど、2つ目の模様が濃く出る
    const P = Math.PI * z;
    const mode = (a, b, x, y, s) => Math.cos(a * P * x) * Math.cos(b * P * y) + s * Math.cos(b * P * x) * Math.cos(a * P * y);

    return function (x, y) {
      return mode(n, m, x, y, k) + a2 * mode(n2, m2, x, y, -k);
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

  /**
   * 砂の板：今の音に合わせて、砂が動き続けるクラドニ図形（調査画面のゲージの中に置く）
   * 大きさは CSS で決める（キャンバスの画素数は表示された大きさに合わせる）。色は要素の文字色
   *   const p = DetherBadge.plate();
   *   wellEl.prepend(p.el);
   *   p.start();                    // 動かす（測定中だけ）
   *   p.setSpectrum(spectrum);      // 音の形が変わるたびに呼ぶ（measure.js の level の spectrum）
   *   p.stop();                     // 止める（一時停止中など。砂はそのまま残る）
   * @param {Object} [opt]
   * @param {number} [opt.count=1400]  砂粒の数（多いと重い）
   * @param {number} [opt.dot=1.3]     砂粒の大きさ(px)
   */
  function plate(opt) {
    const o = opt || {};
    const count = o.count || 1400;
    const dot = o.dot || 1.3;
    const canvas = document.createElement("canvas");
    canvas.className = "sand-plate";
    canvas.setAttribute("aria-hidden", "true");

    const points = [];
    for (let k = 0; k < count; k++) { // はじめは円の中に均一にまく
      const r = Math.sqrt(Math.random()), t = Math.random() * 2 * Math.PI;
      points.push([r * Math.cos(t), r * Math.sin(t)]);
    }

    const reduceMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let f = null;
    let running = false;
    let raf = 0;
    let lastStill = 0;

    const paint = () => {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const side = Math.round(canvas.clientWidth * dpr);
      if (!side) return; // 画面に出ていない
      if (canvas.width !== side) canvas.width = canvas.height = side;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, side, side);
      ctx.fillStyle = getComputedStyle(canvas).color;
      const s = dot * dpr;
      for (const p of points) ctx.fillRect(((p[0] + 1) / 2) * side - s / 2, ((p[1] + 1) / 2) * side - s / 2, s, s);
    };

    const frame = () => {
      raf = 0;
      if (!running) return;
      if (f) settle(points, f, Math.random);
      paint();
      raf = global.requestAnimationFrame(frame);
    };

    return {
      el: canvas,
      setSpectrum(spectrum) {
        if (!spectrum || spectrum.length < 3) return; // 取れなかったときは前の模様のまま
        f = chladniField(spectrum, 1);
        // 動きを減らす設定の端末では、砂を動かして見せずに、1秒に1回まとめて模様を描き直す
        if (reduceMotion && running && Date.now() - lastStill > 1000) {
          lastStill = Date.now();
          for (let i = 0; i < 15; i++) settle(points, f, Math.random);
          paint();
        }
      },
      start() {
        if (running) return;
        running = true;
        if (reduceMotion) paint();
        else raf = global.requestAnimationFrame(frame);
      },
      stop() {
        running = false;
        if (raf) global.cancelAnimationFrame(raf);
        raf = 0;
      },
    };
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
    fillMedal(el, MARK[code], s, o);
    el.dataset.code = code;
    el.setAttribute("aria-label",
      `${o.band ? BAND[o.band] + "の" : ""}${NAMES[code]}${o.locked ? "（未獲得）" : ""}`);
    return el;
  }

  /** メダルの中身（文字・音の標本・獲得演出）を入れる。medal と tagMedal で共通 */
  function fillMedal(el, markText, s, o) {
    if (o.spectrum && o.spectrum.length >= 3 && !o.locked) {
      // 模様を数字の後ろ・面の上に重ねるため、数字も要素に入れて重なり順を決める（badge.css）
      el.append(specimen(o.spectrum, s, !!o.isNew));
      const mark = document.createElement("span");
      mark.className = "medal__mark";
      mark.textContent = markText;
      el.append(mark);
    } else {
      el.textContent = markText;
    }
    if (o.isNew) {
      el.classList.add("medal--new");
      const shine = document.createElement("span");
      shine.className = "medal__shine";
      shine.setAttribute("aria-hidden", "true");
      el.append(shine);
    }
    el.setAttribute("role", "img");
  }

  /**
   * タグのメダルを1つ作る（音の図鑑・地図のピン・最近の記録）
   * @param {Object} tag  { name, icon, color }。サーバーの Tag.medal と同じ形
   *                      icon … 真ん中の1文字 / color … badge.css の .m-tag-○○ の○○（sage など）
   * @param {string} [size]  medal と同じ
   * @param {Object} [opt]   medal と同じ（locked / isNew / spectrum）。locked のときは文字が「?」になる
   */
  function tagMedal(tag, size, opt) {
    const o = opt || {};
    const s = SIZES.includes(size) ? size : "list";
    const color = TAG_COLORS.includes(tag.color) ? tag.color : "sage";
    const el = document.createElement("span");
    el.className = `medal medal--tag ${o.locked ? "m-lock" : "m-tag-" + color} medal--${s}`;
    fillMedal(el, o.locked ? "?" : tag.icon || (tag.name || "?").slice(0, 1), s, o);
    el.setAttribute("aria-label", o.locked ? "まだ出会っていない音" : `${tag.name}のメダル`);
    return el;
  }

  /**
   * マップのピン（モックの .pin ＋ .pin-count）
   * AdvancedMarkerElement は content の下端中央を地点に合わせるので、
   * メダルの中心が地点に来るよう外側の要素を半分下げている。
   * @param {string|Object} code  バッジのコード。タグのメダルなら { name, icon, color }
   * @param {Object} [opt]
   * @param {number}  [opt.count]     同じ場所のバッジ件数（2以上で右上に表示）
   * @param {boolean} [opt.selected]  選択中の見た目
   * @param {string}  [opt.label]     読み上げ用ラベル（省略時はバッジ名）
   * @param {Function}[opt.onClick]
   */
  function pin(code, opt) {
    // タグのメダルのピン：code の代わりに { name, icon, color } を渡す
    const tag = typeof code === "object" ? code : null;
    if (!tag) check(code);
    const o = opt || {};
    const title = tag ? tag.name : NAMES[code];
    const wrap = document.createElement("div");
    wrap.style.transform = "translateY(50%)";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pin";
    btn.setAttribute("aria-pressed", o.selected ? "true" : "false");
    btn.setAttribute("aria-label", o.label || title + (o.count > 1 ? `ほか${o.count - 1}件` : ""));
    const m = tag ? tagMedal(tag, "pin") : medal(code, "pin");
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

  global.DetherBadge = {
    CODES, MARK, NAMES, RARE, BAND, TAG_COLORS,
    isRare, medal, tagMedal, pin, setPinSelected, row, codeFromBadgeType, specimen, plate,
  };
})(window);
