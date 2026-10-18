/**
 * dether マップ（担当②）
 *
 * - 現在地を取得して中心に地図を表示（精度の円と現在地ピンつき）
 * - 表示範囲のバッジをAPIから取得してピン表示
 *     ローカル（scope: 'mine'）     … 自分の獲得バッジ（/api/badges/mine/）
 *     全国（scope: 'everyone'）    … みんなの「投稿のある」バッジ（/api/badges/everyone/）
 * - 表示範囲のヒートマップ（マスごとの平均dBの色と、代表タグのアイコン）を /api/heatmap から取得して表示
 *     マスはいつでも約50m。1枚のキャンバス（HeatLayer）にまとめて描くので、マスが多くても軽い
 *     測っていないマスは、近くの屋外の記録から推定してうすく塗る（屋内の記録は広げない）
 * - ピンが重なるところは1つにまとめ、右上に件数を出す。どのバッジを上に出すかは PIN_PRIORITY
 *
 * 企画書のルールに合わせた設計:
 *  - 画面(DOM)を触る処理は持たず、結果は CustomEvent で返す（見た目は④が決める）
 *  - 色や余白はCSS変数 / クラス（static/css/map.css）に任せ、JS内にスタイルを書かない
 *  - ピンは google.maps.marker.AdvancedMarkerElement（マップID必須）
 *  - バッジのピンの見た目はリーダーの部品 DetherBadge.pin（static/js/badge.js・static/css/badge.css）
 *
 * 発火するイベント（target 上。既定は地図のコンテナ要素）
 *  dether:map-ready      { center }
 *  dether:position       { lat, lng, accuracy }
 *  dether:position-error { message, fallback }
 *  dether:badges-loaded  { badges }
 *  dether:heatmap-loaded { level, truncated }
 *  dether:badge-click    { badge, badges }   badge = 上に出ているバッジ / badges = まとめた全部（優先順）
 *  dether:error          { message }
 */
(function (global) {
  'use strict';

  // 位置情報が使えないときの中心（東大阪）
  const DEFAULT_CENTER = { lat: 34.6793, lng: 135.601 };
  const DEFAULT_ZOOM = 17;
  const FETCH_DEBOUNCE_MS = 400;
  // ピンの重なり：メダル（44px）の中心どうしがこれより近いと1つにまとめる
  const CLUSTER_PX = 40;
  // マスがこれより小さく見えるときは、タグのアイコンを出さない（ぎっしり並んで読めないため）
  const TAG_MIN_CELL_PX = 30;
  // ヒートマップの色の段階（map.css の --heat-1 〜 --heat-7）。この dB 未満なら その段階
  const HEAT_STEPS = [40, 50, 60, 70, 80, 90];
  // ヒートマップのなじませ方
  const HEAT_ALPHA = 0.72; // 測ったマスの濃さ
  const HEAT_SPREAD = 2; // 屋外の記録を、何マス先（1マス約50m）までなじませるか
  const HEAT_FADE = 1.6; // なじませる強さ。大きいほど遠くまで濃く残る
  const HEAT_EST_MAX = 0.85; // 推定したマスの濃さの上限（測ったマスより必ずうすくする）
  const HEAT_GAP_MIN_PX = 8; // マスがこれより大きく見えるときだけ、マスの間にすき間を入れる

  /**
   * 重なったときに上に出すバッジの決め方（上から順に比べる）
   *  1. レア（昼の静寂・昼の深い静寂・夜の90dB。タグのメダルなら、管理画面で「レア」にしたタグ）
   *  2. 投稿がある（写真や内容が見られる）
   *  3. 取りにくさ … 深い静寂 > 90dB > 静寂 > 80dB > 70dB > タグのメダル（バッジの無い投稿）
   *  4. 新しい
   */
  const PIN_STRENGTH = { q35: 5, b90: 4, q40: 3, b80: 2, b70: 1 };
  function pinPriority(badge) {
    const code = badgeCode(badge);
    const band = badge.time_band_code || (badge.time_band_name === '夜' ? 'n' : 'd');
    const rare = code ? global.DetherBadge.isRare(code, band) : !!badge.rare_tag;
    return [
      rare ? 1 : 0,
      badge.post ? 1 : 0,
      PIN_STRENGTH[code] || 0,
      Date.parse(badge.measured_at) || 0,
    ];
  }
  function byPriority(a, b) {
    const pa = pinPriority(a);
    const pb = pinPriority(b);
    for (let i = 0; i < pa.length; i++) {
      if (pa[i] !== pb[i]) return pb[i] - pa[i];
    }
    return 0;
  }

  /* ---------- Google Maps の読み込み ---------- */
  function loadGoogleMaps(apiKey) {
    if (global.google && global.google.maps && global.google.maps.marker) {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      const cb = '__detherMapsReady';
      global[cb] = function () {
        delete global[cb];
        resolve();
      };
      const s = document.createElement('script');
      s.src =
        'https://maps.googleapis.com/maps/api/js?key=' +
        encodeURIComponent(apiKey) +
        '&libraries=marker&v=weekly&language=ja&callback=' +
        cb;
      s.async = true;
      s.onerror = function () {
        reject(new Error('Google Maps の読み込みに失敗しました（APIキーとドメイン制限を確認）'));
      };
      document.head.appendChild(s);
    });
  }

  /* ---------- 現在地 ---------- */
  function getCurrentPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('この端末では位置情報が使えません'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      });
    });
  }

  // 前回の現在地を覚えておき、次に開いたときの最初の中心にする（この端末の中だけ。サーバーには送らない）
  // localStorage はプライベートモードなどで使えないことがあるので、失敗したら覚えないだけ
  const CENTER_KEY = 'dether-map-center';
  function loadCenter() {
    try {
      const c = JSON.parse(localStorage.getItem(CENTER_KEY));
      return c && Number.isFinite(c.lat) && Number.isFinite(c.lng) ? { lat: c.lat, lng: c.lng } : null;
    } catch (e) {
      return null;
    }
  }
  function saveCenter(p) {
    try {
      localStorage.setItem(CENTER_KEY, JSON.stringify({ lat: p.lat, lng: p.lng }));
    } catch (e) {
      // 覚えられなくても動く
    }
  }

  function geoErrorMessage(err) {
    if (err && err.code === 1) return '位置情報の許可がオフです。設定から許可してください';
    if (err && err.code === 2) return '現在地を取得できませんでした';
    if (err && err.code === 3) return '現在地の取得がタイムアウトしました';
    return (err && err.message) || '現在地を取得できませんでした';
  }

  /* ---------- マーカーの中身 ---------- */
  // バッジのコード（b90 / b80 / b70 / q40 / q35）。APIは code を返す。無いとき（ダミーデータ）は系統としきい値から作る
  // バッジの無い投稿（kind: 'tag'）は null。見た目はタグのメダル（badge.tag）
  function badgeCode(badge) {
    if (badge.kind === 'tag') return null;
    if (badge.code) return badge.code;
    if (badge.system === 'quiet') return Number(badge.threshold_db) <= 35 ? 'q35' : 'q40';
    return 'b' + Math.round(Number(badge.threshold_db));
  }

  // バッジのピンはリーダーの部品（static/js/badge.js の DetherBadge.pin）で作る。
  // マイページや獲得ポップアップのメダルと同じ見た目になり、メダルの中心が地点に来るよう位置も補正済み
  // count が2以上なら、右上に件数が出る（重なってまとめたピン）
  function createBadgeElement(badge, count, onClick) {
    const name = (badge.time_band_name ? badge.time_band_name + 'の' : '') + badge.name;
    return global.DetherBadge.pin(badge.kind === 'tag' ? badge.tag : badgeCode(badge), {
      count: count,
      label: count > 1 ? name + 'ほか' + (count - 1) + '件' : name,
      onClick: onClick,
    });
  }

  // ヒートマップのマスに重ねる、代表タグの丸いアイコン（見た目は map.css の .heat-tag）
  function createTagElement(tag) {
    const el = document.createElement('span');
    el.className = 'heat-tag';
    el.textContent = tag.icon || (tag.name || '').slice(0, 1);
    el.title = tag.name || '';
    return el;
  }

  // 平均dB → 色の段階（1〜7）
  function heatStep(db) {
    let i = 0;
    while (i < HEAT_STEPS.length && db >= HEAT_STEPS[i]) i++;
    return i + 1;
  }

  // 現在地ピン（Google マップと同じ、白い縁の青い点と広がる波紋。見た目は map.css の .me-pin）
  function createMeElement() {
    const el = document.createElement('div');
    el.className = 'me-pin';
    const pulse = document.createElement('span');
    pulse.className = 'me-pin__pulse';
    const dot = document.createElement('span');
    dot.className = 'me-pin__dot';
    el.append(pulse, dot);
    return el;
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /* ---------- 開発用のダミーデータ（?mock=1） ---------- */
  function mockBadges(bounds, timeBand) {
    const out = [];
    const lat0 = (bounds.north + bounds.south) / 2;
    const lng0 = (bounds.east + bounds.west) / 2;
    const dLat = (bounds.north - bounds.south) / 2;
    const dLng = (bounds.east - bounds.west) / 2;
    const defs = [
      { name: '90dBバッジ', system: 'loud', threshold_db: 90, dx: 0.4, dy: 0.3 },
      { name: '80dBバッジ', system: 'loud', threshold_db: 80, dx: -0.5, dy: 0.2 },
      { name: '70dBバッジ', system: 'loud', threshold_db: 70, dx: 0.1, dy: -0.5 },
      { name: '静寂バッジ', system: 'quiet', threshold_db: 40, dx: -0.3, dy: -0.4 },
      { name: '深い静寂バッジ', system: 'quiet', threshold_db: 35, dx: 0.6, dy: -0.2 },
    ];
    defs.forEach(function (d, i) {
      out.push({
        id: 'mock-' + i,
        lat: lat0 + d.dy * dLat,
        lng: lng0 + d.dx * dLng,
        name: d.name,
        system: d.system,
        threshold_db: d.threshold_db,
        time_band: timeBand || null, // TimeBand.id
        time_band_name: '昼',
        time_band_code: 'd',
        avg_db: d.threshold_db + 1.5,
        max_db: d.threshold_db + 6,
        measured_at: new Date().toISOString(),
        tags: [{ id: 1, name: '電車', icon: '電' }],
        post: i % 2 ? null : { description: 'ダミーの投稿です', photo: null, created_at: new Date().toISOString() },
      });
    });
    // 重なりの確認用に、90dB のすぐ隣にもう1つ置く
    out.push(Object.assign({}, out[0], { id: 'mock-near', lat: out[0].lat + dLat * 0.02, post: null }));
    return out;
  }

  // 50mのマスで、まん中あたりにダミーの測定を置く（屋内だけのマスも混ぜる）
  function mockHeatmap(bounds) {
    const cellDeg = { lat: 5 / 12000, lng: 5 / 8000 };
    const cx = Math.floor((bounds.west + bounds.east) / 2 / cellDeg.lng);
    const cy = Math.floor((bounds.south + bounds.north) / 2 / cellDeg.lat);
    const names = [['電車', '電'], ['車', '車'], ['人の声', '声'], ['セミ', '蝉'], ['鳥', '鳥'], null];
    const cells = [];
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if ((dx * 7 + dy * 3 + 40) % 4 !== 0) continue; // ところどころだけ測ったことにする
        const db = 38 + ((dx * 13 + dy * 17 + 100) % 55);
        const indoor = (dx + dy + 20) % 5 === 0;
        const t = names[(dx + dy * 2 + 30) % names.length];
        cells.push({
          x: cx + dx, y: cy + dy, avg_db: db, count: 2,
          out_db: indoor ? null : db, out_count: indoor ? 0 : 2,
          tag: t ? { id: dx, name: t[0], icon: t[1] } : null,
        });
      }
    }
    return { level: '50m', cell_deg: cellDeg, cells: cells, truncated: false };
  }

  /* ---------- ヒートマップの層（1枚のキャンバス） ----------
     Google Maps の OverlayView（地図の上に自分で描く層）を使う。
     地図が動くたびに draw() が呼ばれるので、見えている範囲だけをキャンバスに描き直す。
     ★google.maps が読み込まれてからでないと作れないので、クラスは関数の中で作る */

  // マスの値を決める。測ったマスはその値、測っていないマスは近くの屋外の記録から推定する
  //   推定 = 近い記録ほど強く効く重み付き平均（地震の震度分布図と同じ考え方）
  //   濃さ = 重みの合計。記録から離れるほど、うすくなる
  function estimateHeat(cells) {
    const key = (x, y) => x + ',' + y;
    const measured = new Map();
    const out = [];
    cells.forEach(function (c) {
      measured.set(key(c.x, c.y), true);
      const outdoor = c.out_db !== null && c.out_db !== undefined;
      out.push({ x: c.x, y: c.y, db: outdoor ? c.out_db : c.avg_db, alpha: HEAT_ALPHA, indoor: !outdoor });
    });

    const acc = new Map();
    cells.forEach(function (c) {
      if (c.out_db === null || c.out_db === undefined) return; // 屋内だけのマスは広げない
      const strength = Math.sqrt(Math.min(c.out_count || 1, 9)); // 記録が多いほど少し強く効く（3倍まで）
      for (let dy = -HEAT_SPREAD; dy <= HEAT_SPREAD; dy++) {
        for (let dx = -HEAT_SPREAD; dx <= HEAT_SPREAD; dx++) {
          const d = Math.hypot(dx, dy);
          if (d === 0 || d > HEAT_SPREAD + 1e-9) continue;
          const k = key(c.x + dx, c.y + dy);
          if (measured.has(k)) continue;
          const w = strength * Math.exp((-d * d) / HEAT_FADE);
          const a = acc.get(k) || { x: c.x + dx, y: c.y + dy, sw: 0, swv: 0 };
          a.sw += w;
          a.swv += w * c.out_db;
          acc.set(k, a);
        }
      }
    });
    acc.forEach(function (a) {
      out.push({ x: a.x, y: a.y, db: a.swv / a.sw, alpha: HEAT_ALPHA * Math.min(HEAT_EST_MAX, a.sw), indoor: false });
    });
    return out;
  }

  // 屋内だけのマスに重ねる斜線
  function stripePattern(ctx) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 8;
    const t = tile.getContext('2d');
    t.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    t.lineWidth = 1.5;
    t.beginPath();
    t.moveTo(0, 8);
    t.lineTo(8, 0);
    t.stroke();
    return ctx.createPattern(tile, 'repeat');
  }

  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

  function createHeatLayer() {
    class HeatLayer extends google.maps.OverlayView {
      constructor() {
        super();
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'heat-canvas'; // map.css
        this.cells = []; // estimateHeat() の結果
        this.cellDeg = null;
        this.visible = true;
      }

      onAdd() {
        this.getPanes().overlayLayer.appendChild(this.canvas);
      }

      onRemove() {
        this.canvas.remove();
      }

      setData(cells, cellDeg) {
        this.cells = estimateHeat(cells);
        this.cellDeg = cellDeg;
        this.draw();
      }

      draw() {
        const proj = this.getProjection();
        const map = this.getMap();
        const bounds = map && map.getBounds();
        if (!proj || !bounds) return;

        // キャンバスを、見えている範囲にぴったり重ねる
        const div = map.getDiv();
        const w = div.clientWidth;
        const h = div.clientHeight;
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const top = ne.lat();
        const left = sw.lng();
        const origin = proj.fromLatLngToDivPixel(new google.maps.LatLng(top, left));
        const dpr = Math.min(global.devicePixelRatio || 1, 2);
        const c = this.canvas;
        c.style.left = origin.x + 'px';
        c.style.top = origin.y + 'px';
        c.style.width = w + 'px';
        c.style.height = h + 'px';
        if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
        if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!this.visible || !this.cells.length || !this.cellDeg) return;

        // 緯度経度 → キャンバスの位置。経度はそのまま比例、緯度はメルカトル図法の式で計算する
        const p2 = proj.fromLatLngToDivPixel(new google.maps.LatLng(top, left + 0.01));
        const kx = (p2.x - origin.x) / 0.01; // 経度1度あたりのpx
        const ky = (kx * 180) / Math.PI; // メルカトルの1あたりのpx
        const topY = mercY(top);
        const dLat = this.cellDeg.lat;
        const dLng = this.cellDeg.lng;
        const cellPx = dLng * kx;
        const gap = cellPx >= HEAT_GAP_MIN_PX ? 0.5 : 0; // 拡大したときだけ、マスの境目を見せる

        const colors = [];
        for (let i = 1; i <= 7; i++) colors.push(cssVar('--heat-' + i, '#999999'));
        const stripes = stripePattern(ctx);

        this.cells.forEach(function (cell) {
          const x0 = (cell.x * dLng - left) * kx;
          const x1 = x0 + cellPx;
          const y0 = (topY - mercY((cell.y + 1) * dLat)) * ky; // 北端
          const y1 = (topY - mercY(cell.y * dLat)) * ky; // 南端
          if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) return; // 見えていないマス
          const rw = Math.max(1, x1 - x0 - gap * 2);
          const rh = Math.max(1, y1 - y0 - gap * 2);
          ctx.globalAlpha = cell.alpha;
          ctx.fillStyle = colors[heatStep(cell.db) - 1];
          ctx.fillRect(x0 + gap, y0 + gap, rw, rh);
          if (cell.indoor && cellPx >= HEAT_GAP_MIN_PX) {
            ctx.fillStyle = stripes;
            ctx.fillRect(x0 + gap, y0 + gap, rw, rh);
          }
        });
        ctx.globalAlpha = 1;
      }
    }
    return new HeatLayer();
  }

  /* ---------- 本体 ---------- */
  /**
   * @param {HTMLElement} container 地図を描く要素（高さをCSSで指定しておく）
   * @param {Object} opts
   *   apiKey     Google Maps APIキー（本番用 / 開発用）
   *   mapId      マップID（AdvancedMarkerに必須）
   *   badgesUrl  自分のバッジ取得API（例: /api/badges/mine/）
   *   everyoneUrl みんなの投稿のバッジ取得API（例: /api/badges/everyone/）
   *   heatmapUrl ヒートマップAPI（例: /api/heatmap）。省略でヒートマップを出さない
   *   scope      'mine'（ローカル・既定）/ 'everyone'（全国）
   *   timeBand   表示する時間帯の TimeBand.id（省略で全て）。APIには ?time_band=<id> で送る
   *   seasonal   false なら季節タグ（セミ・祭りなど）の付いた記録を出さない（既定 true）。APIには ?seasonal=0
   *   mock       trueでAPIの代わりにダミーデータを使う
   *   target     イベントの発火先（省略で container）
   */
  function DetherMap(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.target = this.opts.target || container;
    this.timeBand = this.opts.timeBand || '';
    this.scope = this.opts.scope === 'everyone' ? 'everyone' : 'mine';
    this.seasonal = this.opts.seasonal !== false; // 季節タグの付いた記録も出すか（「季節の音」ボタン）
    this.layers = { badges: true, tags: true }; // 「バッジ」の表示切り替え（tags はマスのタグのアイコン）
    this.map = null;
    this.meMarker = null;
    this.accuracyCircle = null;
    this.badges = []; // 最後に取ったバッジ（ズームが変わったら、まとめ直しに使う）
    this.badgeMarkers = new Map(); // 上に出ているバッジのid -> { marker, badge, content, group }
    this.heatLayer = null; // ヒートマップの層（createHeatLayer）。地図ができてから作る
    this.tagMarkers = []; // マスに重ねるタグのアイコン
    this.heatCells = []; // APIから受け取ったマス（タグのアイコンにも使う）
    this.heatCellDeg = null;
    this.selectedId = null; // タップして選択中のバッジ（ピンの見た目を変える）
    this.lastPosition = null;
    this._watchId = null;
    this._fetchTimer = null;
    this._abort = null;
  }

  DetherMap.prototype._emit = function (name, detail) {
    this.target.dispatchEvent(new CustomEvent('dether:' + name, { detail: detail }));
  };

  DetherMap.prototype.init = async function () {
    try {
      await loadGoogleMaps(this.opts.apiKey);
    } catch (e) {
      this._emit('error', { message: e.message });
      return this;
    }

    // 1. 地図をすぐ表示する。中心は前回の現在地（無ければ既定の中心）
    // ★現在地を待ってから表示すると、屋内などでGPSが決まるまで（最大10秒）真っ白になるため
    const center = loadCenter() || DEFAULT_CENTER;
    this._userMoved = false;
    this._createMap(center, DEFAULT_ZOOM);

    // サイトのライト／ダーク（base.html の data-theme）が切り替わったら、地図も合わせる
    const self = this;
    new MutationObserver(function () { self._applyTheme(); }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    this._emit('map-ready', { center: center });

    // 2. 現在地は地図を出した後に取る。取れたらそこへ移す（失敗したら今の中心のまま）
    getCurrentPosition()
      .then(function (pos) {
        self.lastPosition = self._toPosition(pos);
        self._updateMe(self.lastPosition);
        if (!self._userMoved) self.map.setCenter({ lat: self.lastPosition.lat, lng: self.lastPosition.lng });
        saveCenter(self.lastPosition);
        self._emit('position', self.lastPosition);
      })
      .catch(function (err) {
        self._emit('position-error', { message: geoErrorMessage(err), fallback: center });
      });

    this._startWatch();
    return this;
  };

  const themeScheme = () => (document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT');

  /**
   * 地図を作る。ライト／ダーク（colorScheme）は地図を作るときにしか決められないので、
   * テーマが変わったら _applyTheme() がこれを呼んで作り直す。
   * ★同じ要素に地図を作り直すと不安定なので、中に地図用の要素を1つ作って、毎回入れ替える
   */
  DetherMap.prototype._createMap = function (center, zoom) {
    const el = document.createElement('div');
    el.className = 'dether-map__canvas'; // map.css（入れ物いっぱいに広げる）
    if (this._mapEl) this._mapEl.replaceWith(el);
    else this.container.append(el);
    this._mapEl = el;
    this._scheme = themeScheme();

    this.map = new google.maps.Map(el, {
      center: center,
      zoom: zoom,
      mapId: this.opts.mapId,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy', // 片手操作向け
      clickableIcons: false,
      colorScheme: this._scheme, // サイトのテーマに合わせて地図も暗くする
    });

    // 地図の移動が止まるたびに、表示範囲のバッジを取り直す
    this.map.addListener('idle', this._scheduleFetch.bind(this));
    // 現在地が取れる前に自分で地図を動かしたら、取れても中心を動かさない
    const self = this;
    this.map.addListener('dragstart', function () { self._userMoved = true; });

    this.heatLayer = createHeatLayer();
    this.heatLayer.setMap(this.map);
  };

  /** テーマが変わったら、今の場所と拡大率のまま地図を作り直し、ピンやヒートマップを載せ直す */
  DetherMap.prototype._applyTheme = function () {
    if (!this.map || themeScheme() === this._scheme) return;
    const center = this.map.getCenter().toJSON();
    const zoom = this.map.getZoom();

    // 前の地図に載せていたものを外す
    this.badgeMarkers.forEach(function (e) { e.marker.map = null; });
    this.badgeMarkers.clear();
    this.tagMarkers.forEach(function (m) { m.map = null; });
    this.tagMarkers = [];
    if (this.heatLayer) this.heatLayer.setMap(null);
    if (this.meMarker) this.meMarker.map = null;
    if (this.accuracyCircle) this.accuracyCircle.setMap(null);
    this.meMarker = null;
    this.accuracyCircle = null;
    google.maps.event.clearInstanceListeners(this.map);

    this._createMap(center, zoom);
    if (this.lastPosition) this._updateMe(this.lastPosition);
    // ヒートマップは手元のデータですぐ描き直す。バッジは地図の準備ができたら（idle）取り直して置く
    this._renderHeatmap();
  };

  DetherMap.prototype._toPosition = function (pos) {
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  };

  /* ----- 現在地の追従（地図の中心は勝手に動かさない） ----- */
  DetherMap.prototype._startWatch = function () {
    if (!navigator.geolocation) return;
    const self = this;
    this._watchId = navigator.geolocation.watchPosition(
      function (pos) {
        self.lastPosition = self._toPosition(pos);
        self._updateMe(self.lastPosition);
        saveCenter(self.lastPosition);
        self._emit('position', self.lastPosition);
      },
      function (err) {
        self._emit('position-error', { message: geoErrorMessage(err), fallback: null });
      },
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
  };

  DetherMap.prototype._updateMe = function (p) {
    const latLng = { lat: p.lat, lng: p.lng };
    if (!this.meMarker) {
      this.meMarker = new google.maps.marker.AdvancedMarkerElement({
        map: this.map,
        position: latLng,
        content: createMeElement(),
        title: '現在地',
        // ★バッジのピン（100）より下にする。上にすると、現在地で取ったバッジが押せなくなる
        zIndex: 50,
      });
      const color = cssVar('--dether-me', '#4285f4');
      this.accuracyCircle = new google.maps.Circle({
        map: this.map,
        center: latLng,
        radius: p.accuracy || 0,
        strokeColor: color,
        strokeOpacity: 0.3,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: 0.15,
        clickable: false,
      });
    } else {
      this.meMarker.position = latLng;
      this.accuracyCircle.setCenter(latLng);
      this.accuracyCircle.setRadius(p.accuracy || 0);
    }
  };

  /** 現在地に戻る（「現在地へ」ボタンから呼ぶ） */
  DetherMap.prototype.recenter = function () {
    if (this.map && this.lastPosition) {
      this.map.panTo({ lat: this.lastPosition.lat, lng: this.lastPosition.lng });
      this.map.setZoom(DEFAULT_ZOOM);
    }
  };

  /* ----- バッジの取得と表示 ----- */
  /** 時間帯のセレクトボックス変更時に呼ぶ */
  DetherMap.prototype.setTimeBand = function (band) {
    this.timeBand = band || '';
    this.refresh();
  };

  /** 季節タグ（セミ・祭りなど、その時期だけの音）の付いた記録を、ヒートマップとバッジに出すか */
  DetherMap.prototype.setSeasonal = function (on) {
    this.seasonal = !!on;
    this.refresh();
  };

  /** ローカル（'mine'）／全国（'everyone'）の切り替え */
  DetherMap.prototype.setScope = function (scope) {
    this.scope = scope === 'everyone' ? 'everyone' : 'mine';
    this._clearBadges(); // 前の地図のピンが一瞬残らないように、先に消す
    this.refresh();
  };

  /** 「バッジ」「タグ」の表示切り替え（name は 'badges' / 'tags'） */
  DetherMap.prototype.setLayer = function (name, on) {
    this.layers[name] = !!on;
    if (name === 'badges') this._renderBadges(this.badges);
    if (name === 'tags') this._renderTags();
  };

  /** 新しい測定でバッジが増えたときなどに呼ぶ */
  DetherMap.prototype.refresh = function () {
    this._fetchBadges();
  };

  DetherMap.prototype._scheduleFetch = function () {
    clearTimeout(this._fetchTimer);
    this._fetchTimer = setTimeout(this._fetchBadges.bind(this), FETCH_DEBOUNCE_MS);
  };

  DetherMap.prototype._fetchBadges = async function () {
    if (!this.map) return;
    const b = this.map.getBounds();
    if (!b) return;
    const bounds = b.toJSON(); // { north, south, east, west }
    const scope = this.scope;

    try {
      let badges;
      let heat = null;
      if (this.opts.mock) {
        badges = mockBadges(bounds, this.timeBand);
        if (this.opts.heatmapUrl) heat = mockHeatmap(bounds);
      } else {
        if (this._abort) this._abort.abort();
        this._abort = new AbortController();

        const params = new URLSearchParams({
          south: bounds.south,
          west: bounds.west,
          north: bounds.north,
          east: bounds.east,
        });
        if (this.timeBand) params.set('time_band', this.timeBand);
        if (!this.seasonal) params.set('seasonal', '0'); // バッジにもヒートマップにも効かせる

        const badgesUrl = scope === 'everyone' ? this.opts.everyoneUrl : this.opts.badgesUrl;
        const heatParams = new URLSearchParams(params);
        if (scope === 'mine') heatParams.set('mine', '1');

        // バッジとヒートマップを同時に取りに行く
        const [data, heatData] = await Promise.all([
          this._getJson(badgesUrl + '?' + params.toString(), 'バッジ'),
          this.opts.heatmapUrl
            ? this._getJson(this.opts.heatmapUrl + '?' + heatParams.toString(), 'ヒートマップ')
            : null,
        ]);
        badges = data.badges || [];
        heat = heatData;
      }
      if (scope !== this.scope) return; // 取っている間に切り替えられた
      if (heat) {
        this.heatCells = heat.cells || [];
        this.heatCellDeg = heat.cell_deg;
        this._renderHeatmap();
        this._emit('heatmap-loaded', { level: heat.level, truncated: !!heat.truncated });
      }
      this.badges = badges;
      this._renderBadges(badges);
      this._emit('badges-loaded', { badges: badges });
    } catch (e) {
      if (e.name === 'AbortError') return;
      this._emit('error', { message: e.message });
    }
  };

  DetherMap.prototype._getJson = async function (url, what) {
    const res = await fetch(url, {
      credentials: 'same-origin', // 見えないアカウントのセッションCookie
      headers: { Accept: 'application/json' },
      signal: this._abort.signal,
    });
    if (!res.ok) throw new Error(what + 'の取得に失敗しました（' + res.status + '）');
    return res.json();
  };

  /* ----- ヒートマップ ----- */
  DetherMap.prototype._renderHeatmap = function () {
    if (this.heatLayer) this.heatLayer.setData(this.heatCells, this.heatCellDeg);
    this._renderTags();
  };

  DetherMap.prototype._renderTags = function () {
    this.tagMarkers.forEach(function (m) { m.map = null; });
    this.tagMarkers = [];
    const deg = this.heatCellDeg;
    if (!this.layers.tags || !this.heatCells.length || !deg) return;

    // マスの大きさ（画面上のpx）。小さすぎるときはアイコンを出さない
    const a = this._toPixel(0, 0);
    const b = this._toPixel(0, deg.lng);
    if (!a || Math.abs(b.x - a.x) < TAG_MIN_CELL_PX) return;

    const self = this;
    this.heatCells.forEach(function (c) {
      if (!c.tag) return;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: self.map,
        position: { lat: (c.y + 0.5) * deg.lat, lng: (c.x + 0.5) * deg.lng },
        content: createTagElement(c.tag),
        zIndex: 10,
      });
      self.tagMarkers.push(marker);
    });
  };

  /** 緯度経度 → 画面上の位置（px）。重なりの判定に使う。地図の準備前は null */
  DetherMap.prototype._toPixel = function (lat, lng) {
    const proj = this.map && this.map.getProjection();
    if (!proj) return null;
    const p = proj.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
    const scale = Math.pow(2, this.map.getZoom());
    return { x: p.x * scale, y: p.y * scale };
  };

  /**
   * 近くて重なるバッジを1つにまとめる。優先順（byPriority）に並べて、
   * 先に置いたピンから CLUSTER_PX 以内のものは、そのピンの仲間にする
   */
  DetherMap.prototype._cluster = function (badges) {
    const self = this;
    const groups = [];
    badges.slice().sort(byPriority).forEach(function (badge) {
      const px = self._toPixel(badge.lat, badge.lng);
      const near = px && groups.find(function (g) {
        return g.px && Math.hypot(g.px.x - px.x, g.px.y - px.y) < CLUSTER_PX;
      });
      if (near) near.items.push(badge);
      else groups.push({ leader: badge, px: px, items: [badge] });
    });
    return groups;
  };

  DetherMap.prototype._clearBadges = function () {
    this.badgeMarkers.forEach(function (e) { e.marker.map = null; });
    this.badgeMarkers.clear();
    this.selectedId = null;
    this.badges = [];
  };

  // まとめ方はズームで変わるので、毎回まとめ直して全部置き直す（多くても500件なので軽い）
  DetherMap.prototype._renderBadges = function (badges) {
    const self = this;
    const selected = this.selectedId;
    this.badgeMarkers.forEach(function (e) { e.marker.map = null; });
    this.badgeMarkers.clear();
    this.selectedId = null;
    if (!this.layers.badges) return;

    this._cluster(badges).forEach(function (g) {
      const id = String(g.leader.id);
      // タップはピンの中のボタンで受ける（marker.addListener('click') は非推奨の警告が出るため）
      const content = createBadgeElement(g.leader, g.items.length, function () {
        self._select(id);
        self._emit('badge-click', { badge: g.leader, badges: g.items });
      });
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: self.map,
        position: { lat: g.leader.lat, lng: g.leader.lng },
        content: content,
        zIndex: 100,
      });
      self.badgeMarkers.set(id, { marker: marker, badge: g.leader, content: content, group: g.items });
    });
    if (selected && this.badgeMarkers.has(selected)) this._select(selected);
  };

  /** 選択中の見た目を外す（シートを閉じたときに呼ぶ） */
  DetherMap.prototype.clearSelection = function () {
    this._select(null);
  };

  /** タップしたピンだけ「選択中」の見た目にする */
  DetherMap.prototype._select = function (id) {
    const prev = this.badgeMarkers.get(this.selectedId);
    if (prev) global.DetherBadge.setPinSelected(prev.content, false);
    const next = this.badgeMarkers.get(id);
    if (next) global.DetherBadge.setPinSelected(next.content, true);
    this.selectedId = next ? id : null;
  };

  DetherMap.prototype.destroy = function () {
    if (this._watchId !== null) navigator.geolocation.clearWatch(this._watchId);
    clearTimeout(this._fetchTimer);
    if (this._abort) this._abort.abort();
    this.badgeMarkers.forEach(function (e) { e.marker.map = null; });
    this.badgeMarkers.clear();
    if (this.heatLayer) this.heatLayer.setMap(null);
    this.tagMarkers.forEach(function (m) { m.map = null; });
  };

  global.DetherMap = DetherMap;
})(window);
