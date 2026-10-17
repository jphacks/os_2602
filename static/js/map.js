/**
 * dether マップ（担当②）
 *
 * - 現在地を取得して中心に地図を表示（精度の円と現在地ピンつき）
 * - 表示範囲のバッジをAPIから取得してピン表示
 *     ローカル（scope: 'mine'）     … 自分の獲得バッジ（/api/badges/mine/）
 *     全国（scope: 'everyone'）    … みんなの「投稿のある」バッジ（/api/badges/everyone/）
 * - 表示範囲のヒートマップ（マスごとの平均dBの色と、代表タグのアイコン）を /api/heatmap から取得して表示
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

  /**
   * 重なったときに上に出すバッジの決め方（上から順に比べる）
   *  1. レア（昼の静寂・昼の深い静寂・夜の90dB）
   *  2. 投稿がある（写真や内容が見られる）
   *  3. 取りにくさ … 深い静寂 > 90dB > 静寂 > 80dB > 70dB
   *  4. 新しい
   */
  const PIN_STRENGTH = { q35: 5, b90: 4, q40: 3, b80: 2, b70: 1 };
  function pinPriority(badge) {
    const code = badgeCode(badge);
    const band = badge.time_band_code || (badge.time_band_name === '夜' ? 'n' : 'd');
    return [
      global.DetherBadge.isRare(code, band) ? 1 : 0,
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
  function badgeCode(badge) {
    if (badge.code) return badge.code;
    if (badge.system === 'quiet') return Number(badge.threshold_db) <= 35 ? 'q35' : 'q40';
    return 'b' + Math.round(Number(badge.threshold_db));
  }

  // バッジのピンはリーダーの部品（static/js/badge.js の DetherBadge.pin）で作る。
  // マイページや獲得ポップアップのメダルと同じ見た目になり、メダルの中心が地点に来るよう位置も補正済み
  // count が2以上なら、右上に件数が出る（重なってまとめたピン）
  function createBadgeElement(badge, count, onClick) {
    const name = (badge.time_band_name ? badge.time_band_name + 'の' : '') + badge.name;
    return global.DetherBadge.pin(badgeCode(badge), {
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

  function mockHeatmap(bounds) {
    const cells = [];
    const names = [['電車', '電'], ['車', '車'], ['人の声', '声'], ['セミ', '蝉'], ['鳥', '鳥'], null];
    const rows = 8;
    const cols = 6;
    const h = (bounds.north - bounds.south) / rows;
    const w = (bounds.east - bounds.west) / cols;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if ((x * 7 + y * 3) % 5 === 0) continue; // ところどころ空ける
        const db = 35 + ((x * 13 + y * 17) % 60);
        const t = names[(x + y * 2) % names.length];
        cells.push({
          x: x, y: y,
          south: bounds.south + y * h, north: bounds.south + (y + 1) * h,
          west: bounds.west + x * w, east: bounds.west + (x + 1) * w,
          avg_db: db, count: 3,
          tag: t ? { id: x, name: t[0], icon: t[1] } : null,
        });
      }
    }
    return { level: '100m', cells: cells, truncated: false };
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
   *   mock       trueでAPIの代わりにダミーデータを使う
   *   target     イベントの発火先（省略で container）
   */
  function DetherMap(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.target = this.opts.target || container;
    this.timeBand = this.opts.timeBand || '';
    this.scope = this.opts.scope === 'everyone' ? 'everyone' : 'mine';
    this.layers = { badges: true, tags: true }; // 「バッジ」「タグ」の表示切り替え
    this.map = null;
    this.meMarker = null;
    this.accuracyCircle = null;
    this.badges = []; // 最後に取ったバッジ（ズームが変わったら、まとめ直しに使う）
    this.badgeMarkers = new Map(); // 上に出ているバッジのid -> { marker, badge, content, group }
    this.heatRects = []; // ヒートマップのマス（google.maps.Rectangle）
    this.tagMarkers = []; // マスに重ねるタグのアイコン
    this.heatCells = [];
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
    this.map = new google.maps.Map(this.container, {
      center: center,
      zoom: DEFAULT_ZOOM,
      mapId: this.opts.mapId,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy', // 片手操作向け
      clickableIcons: false,
      // サイトのテーマ（base.html の data-theme）に合わせて地図も暗くする
      colorScheme: document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT',
    });

    // 地図の移動が止まるたびに、表示範囲のバッジを取り直す
    this.map.addListener('idle', this._scheduleFetch.bind(this));
    // 現在地が取れる前に自分で地図を動かしたら、取れても中心を動かさない
    let userMoved = false;
    this.map.addListener('dragstart', function () { userMoved = true; });

    this._emit('map-ready', { center: center });

    // 2. 現在地は地図を出した後に取る。取れたらそこへ移す（失敗したら今の中心のまま）
    const self = this;
    getCurrentPosition()
      .then(function (pos) {
        self.lastPosition = self._toPosition(pos);
        self._updateMe(self.lastPosition);
        if (!userMoved) self.map.setCenter({ lat: self.lastPosition.lat, lng: self.lastPosition.lng });
        saveCenter(self.lastPosition);
        self._emit('position', self.lastPosition);
      })
      .catch(function (err) {
        self._emit('position-error', { message: geoErrorMessage(err), fallback: center });
      });

    this._startWatch();
    return this;
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

        const badgesUrl = scope === 'everyone' ? this.opts.everyoneUrl : this.opts.badgesUrl;
        const heatParams = new URLSearchParams(params);
        heatParams.set('zoom', String(this.map.getZoom()));
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
    this.heatRects.forEach(function (r) { r.setMap(null); });
    this.heatRects = [];
    const colors = [];
    for (let i = 1; i <= 7; i++) colors.push(cssVar('--heat-' + i, '#999999'));
    const line = cssVar('--heat-line', 'rgba(255,255,255,0.5)');

    const self = this;
    this.heatCells.forEach(function (c) {
      self.heatRects.push(
        new google.maps.Rectangle({
          map: self.map,
          bounds: { south: c.south, west: c.west, north: c.north, east: c.east },
          fillColor: colors[heatStep(c.avg_db) - 1],
          fillOpacity: 0.72,
          strokeColor: line,
          strokeOpacity: 1,
          strokeWeight: 0.5,
          clickable: false,
          zIndex: 1,
        })
      );
    });
    this._renderTags();
  };

  DetherMap.prototype._renderTags = function () {
    this.tagMarkers.forEach(function (m) { m.map = null; });
    this.tagMarkers = [];
    if (!this.layers.tags || !this.heatCells.length) return;

    // マスの大きさ（画面上のpx）。小さすぎるときはアイコンを出さない
    const c0 = this.heatCells[0];
    const a = this._toPixel(c0.south, c0.west);
    const b = this._toPixel(c0.north, c0.east);
    if (!a || Math.abs(b.x - a.x) < TAG_MIN_CELL_PX) return;

    const self = this;
    this.heatCells.forEach(function (c) {
      if (!c.tag) return;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: self.map,
        position: { lat: (c.south + c.north) / 2, lng: (c.west + c.east) / 2 },
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
    this.heatRects.forEach(function (r) { r.setMap(null); });
    this.tagMarkers.forEach(function (m) { m.map = null; });
  };

  global.DetherMap = DetherMap;
})(window);
