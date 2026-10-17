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
from django.shortcuts import render

# 調査ページの「最近の記録」に出す件数（static/js/survey_page.js の RECENT_MAX と同じ）
RECENT_COUNT = 3


def index(request):
    """調査ページ（トップ）。調査ボタンと、自分の最近の記録を出す。"""
    recent = []
    if request.user.is_authenticated:
        measurements = request.user.measurements.select_related("time_band").prefetch_related(
            "tags", "badges__badge_type"
        )[:RECENT_COUNT]
        recent = [_recent_row(m) for m in measurements]
    return render(request, "index.html", {"title": "調査", "recent": recent})


def _recent_row(measurement):
    """「最近の記録」の1行分。タイトルはタグ → バッジ名 → 「タグなし」の順で決める。"""
    badges = list(measurement.badges.all())
    best = max(badges, key=lambda b: b.badge_type.strength).badge_type if badges else None
    tags = [tag.name for tag in measurement.tags.all()]
    return {
        "measurement": measurement,
        "title": "・".join(tags) or (best.name if best else "タグなし"),
        "badge": best,  # バッジの見た目は templates/components/badge.html に best.code を渡して描く
    }


def health(request):
    """動作確認用。

    AWSやNginxが「アプリが生きているか」を定期的に確認しに来る先。
    開発中も「画面が出ない…アプリ自体は動いてる?」の切り分けに使える。
    """
    return JsonResponse({"status": "ok"})


def map_view(request):
    return render(request, "map.html")
