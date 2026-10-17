/* ===========================================================================
   main.js = 全ページ共通の道具

   ▼ ここには共通処理だけを置く
     ページ固有の処理を書くと6人で編集したときに衝突する。
     ページごとに別ファイルを作り、そのページのHTMLで読み込む:

       {% block scripts %}
         <script src="{% static 'js/mypage.js' %}"></script>
       {% endblock %}

   ▼ サーバー側との約束ごと(Django側の作りに合わせてある)
     ・送信には整理券(CSRFトークン)が必要 → 下の api が自動で付ける
     ・整理券はヘッダー "X-CSRFToken" で送る(Djangoが決めている名前)
     ・失敗時のサーバーの返事は {"error": "メッセージ"} の形
       → その文言をそのまま画面に出せるようにしてある
   =========================================================================== */

/* base.html の <meta name="csrf-token"> に埋め込まれた整理券を読む。
   Django側(CsrfViewMiddleware)がこれを確認する。 */
const CSRF_TOKEN = document
  .querySelector('meta[name="csrf-token"]')
  ?.getAttribute("content");

/**
 * 取得(GET)
 *   const data = await api.get("/api/todos");
 */
async function apiGet(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  return handleResponse(response);
}

/**
 * 送信(POST / PATCH / DELETE)
 *   await api.post("/api/todos/create", { title: "牛乳を買う" });
 *   await api.patch("/api/todos/3");
 *   await api.delete("/api/todos/3/delete");
 */
async function apiSend(url, data = null, method = "POST") {
  const options = {
    method: method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      // ★これが無いと Django に 403 で弾かれる(成りすまし対策)
      "X-CSRFToken": CSRF_TOKEN,
    },
  };

  if (data !== null) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options);
  return handleResponse(response);
}

/**
 * サーバーの返事を解釈する。
 * Django側が {"error": "..."} を返していれば、その文言をそのまま使う。
 */
async function handleResponse(response) {
  let payload = null;

  // サーバーが落ちるとHTMLが返ることもあるので、変換失敗を許容する。
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error || `通信に失敗しました (ステータス: ${response.status})`;
    throw new Error(message);
  }

  return payload;
}

const api = {
  get: apiGet,
  post: (url, data) => apiSend(url, data, "POST"),
  put: (url, data) => apiSend(url, data, "PUT"),
  patch: (url, data) => apiSend(url, data, "PATCH"),
  delete: (url) => apiSend(url, null, "DELETE"),
};

/**
 * Python側の messages と同じ見た目でメッセージを出す。
 *   showMessage("保存しました", "success");
 * 種類は "success" / "error" / "warning" / "info"。
 */
function showMessage(text, category = "info") {
  let list = document.querySelector(".flash-list");

  if (!list) {
    list = document.createElement("ul");
    list.className = "flash-list";
    const header = document.querySelector(".site-header");
    header?.insertAdjacentElement("afterend", list);
  }

  const item = document.createElement("li");
  item.className = `flash flash-${category}`;
  // 利用者の入力が混ざる可能性があるので innerHTML は使わない
  item.textContent = text;
  list.appendChild(item);

  setTimeout(() => item.remove(), 4000);
}

/**
 * 送信中はボタンを無効化して二重送信を防ぐ。
 *   await withBusy(button, async () => {
 *     await api.post("/api/todos/create", { title: "牛乳" });
 *   });
 */
async function withBusy(button, task) {
  if (button) {
    button.disabled = true;
  }
  try {
    return await task();
  } finally {
    // 失敗してもボタンを戻す(戻さないと永久に押せなくなる)
    if (button) {
      button.disabled = false;
    }
  }
}
