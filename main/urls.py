# =============================================================================
# urls.py = このアプリが担当するURLの一覧
#
# ▼ ★画面を1枚増やすときの手順
#
#   ① templates/ にHTMLを1枚置く  ② views.py に関数を書く  ③ ここに1行足す
#
# ▼ ★トップページはまだ空いている
#
#   今 "/" を開くとデモページが出るのは、ここに "" が無いから。
#   下の見本のコメントを外せば自分たちの画面に入れ替わる(消す作業は不要)。
#
# ▼ name="..." を付けておくと、HTMLから {% url 'main:posts' %} と書ける。
#
#   URLを直書きせず名前で呼べば、後からURLを変えても呼び出し側を直さずに済む。
# =============================================================================

from django.urls import path

from main import views

# このアプリのURLにまとめて名札を付ける("main:health" のように呼ぶ)。
app_name = "main"

urlpatterns = [
    # --- 画面を返すURL ---
    #
    # ★ここから書きはじめる(コメントを外す)
    # path("", views.index, name="index"),
    path("health", views.health, name="health"),
    # --- JavaScript向けにデータを返すURL ---
    #
    # <int:post_id> と書くと、その部分を数字として受け取り、
    # ビューの引数 post_id に渡せる。
    # path("api/posts", api.list_posts, name="api_list_posts"),
]
