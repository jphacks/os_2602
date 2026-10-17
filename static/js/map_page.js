/* マップページ専用の処理（map.html だけで読み込む） */
(function () {
  'use strict';

  const mapEl = document.getElementById('map');
  const sheet = document.getElementById('badge-sheet');
  const recenterBtn = document.getElementById('recenter');
  if (!mapEl) return;

  // 同じメッセージを連続で出さない
  let lastMessage = '';
  function notify(text, category) {
    if (text === lastMessage) return;
    lastMessage = text;
    showMessage(text, category); // main.js の関数
  }

  mapEl.addEventListener('dether:position-error', (e) => notify(e.detail.message, 'warning'));
  mapEl.addEventListener('dether:error', (e) => notify(e.detail.message, 'error'));
  mapEl.addEventListener('dether:position', () => { lastMessage = ''; });
  mapEl.addEventListener('dether:map-ready', () => { sheet.hidden = true; });

  mapEl.addEventListener('dether:badge-click', (e) => {
    const b = e.detail.badge;
    const title = document.createElement('strong');
    title.textContent = b.name;
    const detail = document.createElement('div');
    detail.textContent = '平均 ' + Number(b.avg_db).toFixed(1) + ' dB';
    const date = document.createElement('small');
    date.textContent = new Date(b.measured_at).toLocaleString('ja-JP');
    sheet.replaceChildren(title, detail, date);
    sheet.hidden = false;
  });

  const params = new URLSearchParams(location.search);
  const detherMap = new DetherMap(mapEl, {
    apiKey: mapEl.dataset.apiKey,
    mapId: mapEl.dataset.mapId,
    badgesUrl: mapEl.dataset.badgesUrl,
    mock: params.get('mock') === '1', // /map/?mock=1 でAPIなしの確認
  });
  detherMap.init();

  recenterBtn.addEventListener('click', () => detherMap.recenter());
})();
