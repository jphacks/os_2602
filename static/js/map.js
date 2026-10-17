/**
 * dether ローカルマップ（担当②）
 *
 * - 現在地を取得して中心に地図を表示（精度の円と現在地ピンつき）
 * - 表示範囲の「自分の獲得バッジ」をAPIから取得してピン表示
 *
 * 企画書のルールに合わせた設計:
 *  - 画面(DOM)を触る処理は持たず、結果は CustomEvent で返す（見た目は④が決める）
 *  - 色や余白はCSS変数 / クラス（static/css/map.css）に任せ、JS内にスタイルを書かない
 *  - ピンは google.maps.marker.AdvancedMarkerElement（マップID必須）
 *
 * 発火するイベント（target 上。既定は地図のコンテナ要素）
 *  dether:map-ready      { center }
 *  dether:position       { lat, lng, accuracy }
 *  dether:position-error { message, fallback }
 *  dether:badges-loaded  { badges }
 *  dether:badge-click    { badge }
 *  dether:error          { message }
 */
(function (global) {
  'use strict';

  // 位置情報が使えないときの中心（東大阪）
  const DEFAULT_CENTER = { lat: 34.6793, lng: 135.601 };
  const DEFAULT_ZOOM = 17;
  const FETCH_DEBOUNCE_MS = 400;

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

  function geoErrorMessage(err) {
    if (err && err.code === 1) return '位置情報の許可がオフです。設定から許可してください';
    if (err && err.code === 2) return '現在地を取得できませんでした';
    if (err && err.code === 3) return '現在地の取得がタイムアウトしました';
    return (err && err.message) || '現在地を取得できませんでした';
  }

  /* ---------- マーカーの中身（見た目はCSSクラスと data 属性で決まる） ---------- */
  function createBadgeElement(badge) {
    const el = document.createElement('div');
    el.className = 'badge-pin';
    el.dataset.system = badge.system; // "loud" | "quiet"
    el.dataset.band = badge.time_band; // TimeBand.id（DBに合わせる）
    el.dataset.bandName = badge.time_band_name || ''; // TimeBand.name（"昼" / "夜"。夜のピンの枠色に使う）
    el.textContent = badge.system === 'quiet' ? '静' : String(badge.threshold_db);
    el.title = badge.name;
    return el;
  }

  function createMeElement() {
    const el = document.createElement('div');
    el.className = 'me-pin';
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
        avg_db: d.threshold_db + 1.5,
        measured_at: new Date().toISOString(),
      });
    });
    return out;
  }

  /* ---------- 本体 ---------- */
  /**
   * @param {HTMLElement} container 地図を描く要素（高さをCSSで指定しておく）
   * @param {Object} opts
   *   apiKey     Google Maps APIキー（本番用 / 開発用）
   *   mapId      マップID（AdvancedMarkerに必須）
   *   badgesUrl  自分のバッジ取得API（例: /api/badges/mine/）
   *   timeBand   表示する時間帯の TimeBand.id（省略で全て）。APIには ?time_band=<id> で送る
   *   mock       trueでAPIの代わりにダミーデータを使う
   *   target     イベントの発火先（省略で container）
   */
  function DetherMap(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.target = this.opts.target || container;
    this.timeBand = this.opts.timeBand || '';
    this.map = null;
    this.meMarker = null;
    this.accuracyCircle = null;
    this.badgeMarkers = new Map(); // id -> { marker, badge }
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

    // 1. 現在地を取得（失敗したら既定の中心で続行）
    let center = DEFAULT_CENTER;
    try {
      const pos = await getCurrentPosition();
      this.lastPosition = this._toPosition(pos);
      center = { lat: this.lastPosition.lat, lng: this.lastPosition.lng };
    } catch (err) {
      this._emit('position-error', { message: geoErrorMessage(err), fallback: DEFAULT_CENTER });
    }

    // 2. 地図を表示
    this.map = new google.maps.Map(this.container, {
      center: center,
      zoom: DEFAULT_ZOOM,
      mapId: this.opts.mapId,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy', // 片手操作向け
      clickableIcons: false,
    });

    if (this.lastPosition) this._updateMe(this.lastPosition);

    // 地図の移動が止まるたびに、表示範囲のバッジを取り直す
    this.map.addListener('idle', this._scheduleFetch.bind(this));

    this._emit('map-ready', { center: center });
    if (this.lastPosition) this._emit('position', this.lastPosition);

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
        zIndex: 1000,
      });
      const color = cssVar('--dether-me', '#2f6fed');
      this.accuracyCircle = new google.maps.Circle({
        map: this.map,
        center: latLng,
        radius: p.accuracy || 0,
        strokeColor: color,
        strokeOpacity: 0.4,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: 0.12,
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

    try {
      let badges;
      if (this.opts.mock) {
        badges = mockBadges(bounds, this.timeBand);
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

        const res = await fetch(this.opts.badgesUrl + '?' + params.toString(), {
          credentials: 'same-origin', // 見えないアカウントのセッションCookie
          headers: { Accept: 'application/json' },
          signal: this._abort.signal,
        });
        if (!res.ok) throw new Error('バッジの取得に失敗しました（' + res.status + '）');
        const data = await res.json();
        badges = data.badges || [];
      }
      this._renderBadges(badges);
      this._emit('badges-loaded', { badges: badges });
    } catch (e) {
      if (e.name === 'AbortError') return;
      this._emit('error', { message: e.message });
    }
  };

  DetherMap.prototype._renderBadges = function (badges) {
    const self = this;
    const nextIds = new Set(badges.map(function (b) { return String(b.id); }));

    // 範囲外・時間帯違いになったピンを消す
    this.badgeMarkers.forEach(function (entry, id) {
      if (!nextIds.has(id)) {
        entry.marker.map = null;
        self.badgeMarkers.delete(id);
      }
    });

    // 新しいピンだけ追加する
    badges.forEach(function (badge) {
      const id = String(badge.id);
      if (self.badgeMarkers.has(id)) return;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: self.map,
        position: { lat: badge.lat, lng: badge.lng },
        content: createBadgeElement(badge),
        title: badge.name,
      });
      marker.addListener('click', function () {
        self._emit('badge-click', { badge: badge });
      });
      self.badgeMarkers.set(id, { marker: marker, badge: badge });
    });
  };

  DetherMap.prototype.destroy = function () {
    if (this._watchId !== null) navigator.geolocation.clearWatch(this._watchId);
    clearTimeout(this._fetchTimer);
    if (this._abort) this._abort.abort();
    this.badgeMarkers.forEach(function (e) { e.marker.map = null; });
    this.badgeMarkers.clear();
  };

  global.DetherMap = DetherMap;
})(window);
