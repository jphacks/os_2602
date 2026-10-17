# =============================================================================
# api.py = JavaScript向けの受付(画面ではなくデータを返す)
#
# ▼ views.py との違い
#
#   views.py … HTMLを丸ごと返す。ページが切り替わる。
#   api.py   … データだけ返す。ページを切り替えずに一部だけ書き換えられる。
#
#   使い分けの目安:
#     ページ移動を伴う操作(ログイン、詳細ページへ移動) → views.py
#     その場で追加・削除・チェック(いいね、Todo追加)   → api.py
#
# ▼ JavaScript側との対応
#
#   送受信の作法(整理券を付ける、エラーを拾う)は static/js/main.js の api が
#   やってくれるので、JS側は api.post("/api/○○", { ... }) と書くだけでよい。
#
# ▼ ★動く見本
#
#   demo/api.py に一式(一覧・追加・切り替え・削除)があります。
#   同じ形をここにコピーして、自分たちのデータ向けに直すのが速いです。
# =============================================================================

import json

from django.http import JsonResponse


def json_response(data: dict, status: int = 200) -> JsonResponse:
    """JSONを返す。日本語をそのまま読める形で返すための共通の入口。

    ★JsonResponse をそのまま使うと、日本語が "\\u5185\\u5bb9" のような
      記号の羅列になる。JavaScriptは問題なく読めるので動作に影響はないが、
      ブラウザの開発者ツールで中身を確認するときに読めず、
      「文字化けしている」と勘違いして原因調査が遠回りになる。
      ensure_ascii=False を指定すると、日本語のまま返る。
    """
    return JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})


def read_json(request):
    """送られてきたJSONを辞書にする。失敗したら返事も作って返す。

    (中身, None) か (None, エラーの返事) のどちらかが返る。
    同じ「形式が変です」の処理を各所に書かないための工夫。
    """
    try:
        return json.loads(request.body), None
    except (ValueError, UnicodeDecodeError):
        return None, json_response({"error": "送信内容の形式が正しくありません。"}, status=400)


# ★ここから書きはじめる(URLの登録は main/urls.py)
#
#   @require_http_methods(["GET"])
#   def list_posts(request):
#       posts = Post.objects.all()[:100]   # ★上限を付けて取りすぎを防ぐ
#       return json_response({"posts": [p.to_dict() for p in posts]})
