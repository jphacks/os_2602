# =============================================================================
# errors.py = エラー画面(400 / 403 / 404 / 500)を返す担当
#
#   これが無いと、存在しないURLを開いた人に Django の素っ気ない「Not Found」だけが
#   返る。ヘッダーもCSSも無い真っ白な画面なので「サイトが壊れた」としか見えない。
#
#   ▼ 使い方
#
#       from django.http import Http404
#       raise Http404
#
#     「あるかどうか分からないものを取ってくる」場合はこちらが短い:
#
#       from django.shortcuts import get_object_or_404
#       post = get_object_or_404(Post, pk=pk)
#
#   ▼ ★開発中はこのページが出ない(これは正常)
#
#     DEBUG=True のとき、Djangoは代わりに原因を教える画面を出す
#     (404ならURL一覧、500なら落ちた行)。直すための情報が欲しい場面なので、
#     そちらのほうが便利だから。ここで作る画面が出るのは DEBUG=False のときだけ。
#
#     ★そのため「本番に出した日に初めてエラー画面を見る」ことになりがち。
#       見た目を先に確かめられるよう、開発モードのときだけ開ける見本のURLを
#       用意している(登録は config/urls.py)。
#
#           http://localhost:8000/__error/404
#
#   ▼ ★関数が4つに分かれている理由
#
#     Djangoは番号ごとに別々の関数を指名する決まりで、しかも500だけ
#     受け取る引数の数が違う。1つにまとめられないので、薄い入口を4つ置いて、
#     中身は show_error() 1つに集めている。
#
#   ▼ 文言を直す・種類を増やす
#
#     下の ERROR_PAGES の表を書き換えるだけ。HTML(error.html)は共通の1枚。
#
#   ▼ 消したいとき
#
#     このファイルと templates/error.html を消し、config/urls.py の
#     handler400〜handler500 の4行と見本のURLを消す。
# =============================================================================

from django.http import JsonResponse
from django.shortcuts import render

# 文言の表。★直すのはここ。
#
# ★400番台は送ってきた側の問題、500番台はこちら側の問題。
#   この区切りは検索エンジンも見ていて、「ページが無い」ときに200を返すと
#   無いページが検索結果に載り続ける。
#
# ★401 はDjangoが自動では使わない。Djangoは「権限がない」を403で表すので、
#   ログインが必要なページは403になる。401は自分で返したいとき用。
ERROR_PAGES = {
    400: ("Bad Request", "リクエストの内容に誤りがあります。"),
    401: ("Unauthorized", "このページを表示する権限がありません。"),
    403: ("Forbidden", "このページを表示する権限がありません。"),
    404: ("Not Found", "指定されたページが見つかりませんでした。"),
    500: ("Internal Server Error", "サーバー側で問題が発生しました。時間をおいて試してください。"),
}

# 表に無い番号が来たときの文言。
# ★何も返さないと真っ白な画面になるので、受け皿を必ず用意する。
FALLBACK_ERROR_PAGE = ("Error", "問題が発生しました。")


def show_error(request, status: int):
    """エラー画面を作って返す。4つの入口すべてがここに集まる。

    ★JavaScript向けのURL(/api/...)にはHTMLではなくJSONを返す。
      main.js は {"error": "..."} の形を待っているので、HTMLを返すと
      JS側が「JSONとして読めない」と別のエラーになり、本当の原因が消える。
    """
    name, message = ERROR_PAGES.get(status, FALLBACK_ERROR_PAGE)

    if request.path.startswith("/api/"):
        # ★json_dumps_params を付けないと日本語が記号の羅列で返る
        #   (demo/api.py の返し方と揃えてある)。
        return JsonResponse(
            {"error": message},
            status=status,
            json_dumps_params={"ensure_ascii": False},
        )

    return render(
        request,
        "error.html",
        {
            "title": str(status),
            "error_code": status,
            "error_name": name,
            "error_message": message,
        },
        status=status,
    )


# -----------------------------------------------------------------------------
# Djangoから指名される入口。
#
# ★名前と引数の数は Django が決めているので、変えると動かない。
#   指名しているのは config/urls.py の handler400〜handler500。
#   exception を使っていないのは、中身を画面に出さないため(原因はログだけ)。
# -----------------------------------------------------------------------------
def bad_request(request, exception=None):
    """400。送られてきた内容そのものが読めないとき。"""
    return show_error(request, 400)


def permission_denied(request, exception=None):
    """403。ログインが必要なページや、他人のデータを触ろうとしたとき。"""
    return show_error(request, 403)


def page_not_found(request, exception=None):
    """404。いちばん多い。URLの打ち間違いと、消したページへの古いリンク。"""
    return show_error(request, 404)


def server_error(request):
    """500。★ここだけ exception を受け取らない(Djangoの決まり)。

    ★この関数の中で落ちると、もう受け皿が無い。
      「500が出る状況」はDBが落ちているときでもあり得るので、
      ここではDBを読んだり重い処理をしたりしない。
    """
    return show_error(request, 500)
