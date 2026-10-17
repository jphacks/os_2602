# =============================================================================
# urls.py = URLの受付(親)
#
#   ブラウザ「/ をください」 → ここ → 担当のアプリへ振り分け
#
# ▼ ★2段構えになっている
#
#   ここは「どのアプリに任せるか」だけを決める案内所。
#   実際のURLは、各アプリの urls.py に書く。
#
#       config/urls.py    … /auth/ で始まるものは accounts に任せる  ← このファイル
#       main/urls.py      … / や /api/○○ など、自分たちで作るURL
#       accounts/urls.py  … /auth/login など
#
#   全URLを1ファイルに書くと巨大になり、6人で編集したとき必ず衝突する。
#   アプリごとに分けておけば別ファイルを触るので衝突しない。
#
# ▼ このファイルは基本的に触らない
#
#   URLを増やすときに触るのは main/urls.py や accounts/urls.py。
#   ここを触るのは「新しいアプリを作ったとき」だけ。
# =============================================================================

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView, TemplateView

urlpatterns = [
    # ★管理画面。Djangoが最初から用意してくれている、データの編集画面。
    #   http://localhost:8000/admin/ で開ける(使い方は docs/SETUP.md)。
    path("admin/", admin.site.urls),
    # include(...) = 「この先は main アプリの urls.py に任せる」という指定。
    path("", include("main.urls")),
    # ★サイト直下に置かなければならない2つ。
    #   検索エンジンは /robots.txt しか見に来ない(中身は templates/robots.txt)。
    #   ブラウザは最後の手段として /favicon.ico を取りに来る。
    #   ★content_type を忘れるとHTMLとして返してしまい、検索エンジンが読めない。
    #   ★favicon のファイルが無ければ404になるだけで害はない。
    path(
        "robots.txt",
        TemplateView.as_view(template_name="robots.txt", content_type="text/plain"),
    ),
    path(
        "favicon.ico",
        RedirectView.as_view(url=settings.STATIC_URL + "favicon.ico"),
    ),
]

# ★AUTH_ENABLED が False なら、ログイン関連のURLを登録しない。
#   コードを消さずに機能をOFFにできる。
if settings.AUTH_ENABLED:
    urlpatterns += [
        # "auth/" を付けると、accounts/urls.py の "login" が
        # 実際には "/auth/login" になる。
        path("auth/", include("accounts.urls")),
    ]

# --- 利用者が上げたファイル(プロフィールアイコンなど) ---
# ★開発モードのときだけ、Djangoが自分で画像を配る。
#   本番ではNginxが配るので、ここは登録しない(compose.prod.yml 参照)。
#   Djangoに画像配りをさせると遅いうえ、本番では動かないようになっている。
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# =============================================================================
# エラー画面(400 / 403 / 404 / 500)の担当を指名する。中身は main/errors.py。
#
#   ★名前(handler404 など)はDjangoが決めているので変えると効かない。
#     置き場所もこのファイル(いちばん親のurls.py)でなければならない。
#   ★開発中(DEBUG=True)は使われない。代わりにDjangoが原因を教える画面を出す。
# =============================================================================
handler400 = "main.errors.bad_request"
handler403 = "main.errors.permission_denied"
handler404 = "main.errors.page_not_found"
handler500 = "main.errors.server_error"

# --- エラー画面の見本(開発モードのときだけ。本番では登録しない)---
#
# /__error/404 のように開くと、その番号の画面が出る。
# ★開発中は本物のエラーではこの画面が出ないので、一度ここで見ておくこと。
if settings.DEBUG:
    from main import errors as _errors

    urlpatterns += [
        path(
            "__error/<int:status>",
            lambda request, status: _errors.show_error(request, status),
        ),
    ]

# --- デモ(動作確認用のページ) ---
# ★必ず最後に足す。
#   Djangoは上から順に照合して最初に一致したものを使うので、
#   main/urls.py に path("", ...) を書けば、そちらが勝ってデモは出なくなる。
#   開発モードのときだけ。本番では登録しないので絶対に出ない。
if settings.DEBUG:
    urlpatterns += [path("", include("demo.urls"))]
