# =============================================================================
# views.py = 画面(HTML)を返す受付
#
#   ブラウザ「/ をください」 → ここ → 「index.html をどうぞ」
#
# ▼ Djangoでの呼び方
#
#   この「受付の関数」を、Djangoではビュー(view)と呼ぶ。
#   FlaskやGinでいう「ルートの処理」と同じもの。
#
# ▼ 引数の request
#
#   誰が何を送ってきたかが全部入っている。★必ず1つ目に書く。
#       request.POST["username"] … 送信されたフォームの中身
#       request.user             … 今アクセスしている人
#
#   書き方の見本は demo/views.py にある。
# =============================================================================

from django.http import JsonResponse
from django.shortcuts import render  # noqa: F401

# ★ここから書きはじめる(URLの登録は main/urls.py)
#
#   def index(request):
#       # 3つ目の辞書がHTML側への差し込み情報。HTML内の {{ title }} に入る。
#       return render(request, "index.html", {"title": "ホーム"})


def health(request):
    """動作確認用。

    AWSやNginxが「アプリが生きているか」を定期的に確認しに来る先。
    開発中も「画面が出ない…アプリ自体は動いてる?」の切り分けに使える。
    """
    return JsonResponse({"status": "ok"})
