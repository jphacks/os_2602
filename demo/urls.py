# =============================================================================
# デモが担当するURL。
#
# ▼ ★"" (トップページ)がここにある理由
#
#   config/urls.py で main より「後ろ」に読み込まれている。
#   Djangoは上から順に照合して最初に一致したものを使うので、
#   main/urls.py に path("", ...) を書けば、そちらが勝ってデモは出なくなる。
#   デモ側を消す作業は要らない。
#
#   ★/__demo のほうは名前が重ならないので、トップページを作った後も残る。
# =============================================================================

from django.urls import path

from demo import api, views

app_name = "demo"

urlpatterns = [
    # --- 画面 ---
    # トップページ。main/urls.py に "" があれば、ここには届かない。
    path("", views.index, name="top"),
    path("__demo", views.index, name="index"),
    # --- JavaScript向けにデータを返すURL ---
    #
    # <int:todo_id> = URLのこの部分を数字として受け取り、
    #                 ビューの引数 todo_id に渡す、という指定。
    path("__demo/api/todos", api.list_todos, name="api_list_todos"),
    path("__demo/api/todos/create", api.create_todo, name="api_create_todo"),
    path("__demo/api/todos/<int:todo_id>", api.toggle_todo, name="api_toggle_todo"),
    path("__demo/api/todos/<int:todo_id>/delete", api.delete_todo, name="api_delete_todo"),
]
