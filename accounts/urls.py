# =============================================================================
# urls.py = ログイン関係のURL
#
#   config/urls.py で "auth/" を付けて読み込んでいるので、
#   ここに書いた "login" は、実際には "/auth/login" になる。
# =============================================================================

from django.urls import path

from accounts import views

app_name = "accounts"

urlpatterns = [
    path("register", views.register, name="register"),
    path("login", views.login_view, name="login"),
    # ★ログアウトが POST な理由
    #   GETでログアウトできると、他サイトに <img src="/auth/logout"> と
    #   書かれただけで勝手にログアウトさせられてしまう。
    #   「状態を変える操作はPOST」が基本ルール。
    path("logout", views.logout_view, name="logout"),
]
