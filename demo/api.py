# =============================================================================
# デモ用のAPI(画面ではなくデータを返す受付)
#
#   ★これは動作確認用です。自分たちのAPIは main/api.py に書きます。
#     書き方の見本としてどうぞ。
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
#   demo/templates/demo/index.html の中のJSから呼ばれている。
#   送受信の作法(整理券を付ける、エラーを拾う)は main.js の api がやるので、
#   使う側は api.post("/__demo/api/todos/create", { title: "牛乳" }) と書くだけでよい。
# =============================================================================

import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from demo.models import Todo


def json_response(data: dict, status: int = 200) -> JsonResponse:
    """JSONを返す。日本語をそのまま読める形で返すための共通の入口。

    ★JsonResponse をそのまま使うと、日本語が "\\u5185\\u5bb9" のような
      記号の羅列になる。JavaScriptは問題なく読めるので動作に影響はないが、
      ブラウザの開発者ツールで中身を確認するときに読めず、
      「文字化けしている」と勘違いして原因調査が遠回りになる。
      ensure_ascii=False を指定すると、日本語のまま返る。
    """
    return JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})


@require_http_methods(["GET"])
def list_todos(request):
    """一覧を返す。"""
    # [:100] で取りすぎを防ぐ。
    # ★上限が無いと、データが増えたときに画面が固まる。
    todos = Todo.objects.all()[:100]

    return json_response({"todos": [todo.to_dict() for todo in todos]})


@require_http_methods(["POST"])
def create_todo(request):
    """1件追加する。"""
    data, error = _read_json(request)
    if error:
        return error

    title = str(data.get("title", "")).strip()

    # ★入力チェックは必ずサーバー側でもやる。
    #   画面側(HTMLのrequiredやJS)のチェックは、開発者ツールから素通りできる。
    if not title:
        return json_response({"error": "内容を入力してください。"}, status=400)
    if len(title) > 200:
        return json_response({"error": "200文字以内で入力してください。"}, status=400)

    # ★デモのTodoは持ち主を持たない(本番のUserに紐付けない)。
    #   理由は demo/models.py のコメント参照。紐付けの書き方も同じ場所に見本がある。
    todo = Todo(title=title)

    # ★save() を呼んで初めてDBに書き込まれる。
    todo.save()

    # 201 = 「新しく作った」を表す返事。
    return json_response({"todo": todo.to_dict()}, status=201)


@require_http_methods(["PATCH"])
def toggle_todo(request, todo_id: int):
    """済み / 未済 を切り替える。

    引数の todo_id は、urls.py で <int:todo_id> と書いた部分が入ってくる。
    ★int を指定しているので、数字でないURLはここに届く前に404になる。
    """
    todo = Todo.objects.filter(pk=todo_id).first()
    if todo is None:
        return json_response({"error": "見つかりませんでした。"}, status=404)

    todo.is_done = not todo.is_done

    # update_fields を指定すると、その列だけを更新する(速く、事故も少ない)。
    todo.save(update_fields=["is_done"])

    return json_response({"todo": todo.to_dict()})


@require_http_methods(["DELETE"])
def delete_todo(request, todo_id: int):
    """1件消す。"""
    todo = Todo.objects.filter(pk=todo_id).first()
    if todo is None:
        return json_response({"error": "見つかりませんでした。"}, status=404)

    todo.delete()

    return json_response({"deleted": todo_id})


def _read_json(request):
    """送られてきたJSONを辞書にする。失敗したら返事も作って返す。

    (中身, None) か (None, エラーの返事) のどちらかが返る。
    同じ「形式が変です」の処理を各所に書かないための工夫。
    """
    try:
        return json.loads(request.body), None
    except (ValueError, UnicodeDecodeError):
        return None, json_response({"error": "送信内容の形式が正しくありません。"}, status=400)
