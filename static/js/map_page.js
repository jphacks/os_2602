/* ===========================================================================
   map_page.js = マップ（map.html）の画面の処理

   ▼ 役割の分け方
     地図・ピン・ヒートマップ … map.js（DetherMap）。画面のほかの部分には触らない
     画面の操作とシート       … このファイル。DetherMap のイベントを受け取って描くだけ

   ▼ 開発用
     /map/?mock=1 で、APIの代わりにダミーのバッジとヒートマップを出す
   =========================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const mapEl = $('map');
  if (!mapEl) return;

  const Badge = window.DetherBadge;
  const SCOPE_KEY = 'dether-map-scope'; // 最後に見た地図（ローカル／全国）を覚えておく
  const LEGEND_TITLE = {
    mine: 'あなたの測定・マスごとの平均',
    everyone: 'みんなの測定・マスごとの平均',
  };
  const EMPTY_TEXT = {
    mine: 'この範囲には、まだあなたのバッジがありません',
    everyone: 'この範囲には、まだ投稿がありません',
  };

  // 同じメッセージを連続で出さない
  let lastMessage = '';
  function notify(text, category) {
    if (text === lastMessage) return;
    lastMessage = text;
    showMessage(text, category); // main.js の関数
  }

  /* ---------- 地図 ---------- */
  const params = new URLSearchParams(location.search);
  const scope = loadScope();
  const detherMap = new DetherMap(mapEl, {
    apiKey: mapEl.dataset.apiKey,
    mapId: mapEl.dataset.mapId,
    badgesUrl: mapEl.dataset.badgesUrl,
    everyoneUrl: mapEl.dataset.everyoneUrl,
    heatmapUrl: mapEl.dataset.heatmapUrl,
    scope: scope,
    timeBand: $('map-band').value,
    mock: params.get('mock') === '1', // /map/?mock=1 でAPIなしの確認
  });
  showScope(scope);
  detherMap.init();

  mapEl.addEventListener('dether:position-error', (e) => notify(e.detail.message, 'warning'));
  mapEl.addEventListener('dether:error', (e) => notify(e.detail.message, 'error'));
  mapEl.addEventListener('dether:position', () => { lastMessage = ''; });
  mapEl.addEventListener('dether:badges-loaded', (e) => {
    $('map-empty').hidden = e.detail.badges.length > 0;
  });
  mapEl.addEventListener('dether:badge-click', (e) => openSheet(e.detail.badges));

  /* ---------- 上の操作 ---------- */
  document.querySelectorAll('.scope-tabs__tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const next = tab.dataset.scope;
      if (next === detherMap.scope) return;
      showScope(next);
      saveScope(next);
      detherMap.setScope(next);
    });
  });

  $('map-band').addEventListener('change', (e) => detherMap.setTimeBand(e.target.value));
  $('recenter').addEventListener('click', () => detherMap.recenter());

  document.querySelectorAll('.map-layers__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      detherMap.setLayer(btn.dataset.layer, on);
    });
  });

  function showScope(next) {
    document.querySelectorAll('.scope-tabs__tab').forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.scope === next));
    });
    $('heat-legend-title').textContent = LEGEND_TITLE[next];
    $('map-empty').textContent = EMPTY_TEXT[next];
    $('map-empty').hidden = true;
  }

  // localStorage はプライベートモードなどで使えないことがあるので、失敗しても全国にするだけ
  function loadScope() {
    try {
      return localStorage.getItem(SCOPE_KEY) === 'mine' ? 'mine' : 'everyone';
    } catch {
      return 'everyone';
    }
  }
  function saveScope(value) {
    try {
      localStorage.setItem(SCOPE_KEY, value);
    } catch {
      /* 覚えられなくても困らない */
    }
  }

  /* ---------- ピンを押すと出るシート ---------- */
  const sheet = $('spot-sheet');
  $('spot-sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet(); // シートの外（背景）を押したとき
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) closeSheet();
  });

  // badges は map.js が優先順に並べたもの（重なってまとめたピンなら複数）
  function openSheet(badges) {
    $('spot-sheet-count').textContent = badges.length > 1 ? `${badges.length}件` : '';
    $('spot-sheet-list').replaceChildren(...badges.map(spotItem));
    sheet.hidden = false;
    $('spot-sheet-list').scrollTop = 0;
    $('spot-sheet-close').focus();
  }

  function closeSheet() {
    sheet.hidden = true;
    detherMap.clearSelection();
  }

  // 1件分。★投稿の文は他の人が書いたものなので、必ず textContent で入れる（innerHTML は使わない）
  function spotItem(b) {
    const item = $('spot-item').content.firstElementChild.cloneNode(true);
    const slot = (name) => item.querySelector(`[data-slot="${name}"]`);
    const band = b.time_band_code || null;

    // バッジの無い投稿（kind: 'tag'）は、タグのメダル
    const isTag = b.kind === 'tag';
    slot('medal').replaceWith(
      isTag
        ? Badge.tagMedal(b.tag, 'list', { spectrum: b.spectrum })
        : Badge.medal(b.code, 'list', { band, spectrum: b.spectrum })
    );
    slot('name').textContent = b.name;
    const chips = slot('chips');
    if (b.time_band_name) chips.append(chip(b.time_band_name));
    if (isTag ? b.rare_tag : band && Badge.isRare(b.code, band)) chips.append(chip('レア', 'chip--rare'));
    if (detherMap.scope === 'everyone' && b.mine) chips.append(chip('あなた', 'chip--mine'));

    slot('meta').textContent = formatDate(b.measured_at) + `・最大 ${Number(b.max_db).toFixed(1)} dB`;
    slot('db').textContent = Number(b.avg_db).toFixed(1);

    const tags = slot('tags');
    (b.tags || []).forEach((t) => {
      const li = document.createElement('li');
      const icon = document.createElement('span');
      icon.className = 'spot-item__tag-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = t.icon || t.name.slice(0, 1);
      li.append(icon, t.name);
      tags.append(li);
    });
    if (!tags.children.length) tags.remove();

    const text = slot('text');
    const photo = slot('photo');
    if (b.post && b.post.description) text.textContent = b.post.description;
    else if (!b.post) {
      text.textContent = '投稿はまだありません';
      text.classList.add('spot-item__text--empty');
    } else text.remove();
    if (b.post && b.post.photo) photo.src = b.post.photo;
    else photo.remove();
    return item;
  }

  function chip(text, extra) {
    const el = document.createElement('span');
    el.className = 'chip' + (extra ? ' ' + extra : '');
    el.textContent = text;
    return el;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  }
})();
