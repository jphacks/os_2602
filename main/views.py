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

from collections import Counter

from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone

from main.models import MeasurementTag, Tag, TimeBand, UserBadge

# 調査ページの「最近の記録」に出す件数（static/js/survey_page.js の RECENT_MAX と同じ）
RECENT_COUNT = 3

# マイページのバッジの並びと名前（static/js/badge.js の CODES / NAMES と同じ）
BADGE_CODES = ["b90", "b80", "b70", "q40", "q35"]
BADGE_LABELS = {"b90": "90dB", "b80": "80dB", "b70": "70dB", "q40": "静寂", "q35": "深い静寂"}
# 企画書：昼の静寂・昼の深い静寂・夜の90dBはレア（badge.js の RARE と同じ）
RARE = {("q40", "d"), ("q35", "d"), ("b90", "n")}


def index(request):
    """調査ページ（トップ）。調査ボタンと、自分の最近の記録を出す。"""
    recent = []
    if request.user.is_authenticated:
        # タグもバッジも無い記録（「タグなし」になる行）は出さない
        measurements = (
            request.user.measurements.filter(Q(badges__isnull=False) | Q(tags__isnull=False))
            .distinct()
            .select_related("time_band")
            .prefetch_related("tags", "badges__badge_type")[:RECENT_COUNT]
        )
        recent = [_recent_row(m) for m in measurements]

    # 投稿シートのタグ（今選べるものだけ）。季節タグは別の枠に出す
    tags = Tag.available()
    common = [t for t in tags if t.tag_type == Tag.TagType.COMMON]
    seasonal = [t for t in tags if t.tag_type == Tag.TagType.SEASONAL]
    periods = {t.period_label for t in seasonal}
    return render(
        request,
        "index.html",
        {
            "title": "調査",
            "recent": recent,
            "post_tags": common,
            "post_seasonal": seasonal,
            # 季節タグの枠の見出しの横に出す言葉（例：9月〜11月の今だけ）
            # 季節タグの期間がばらばらなら「今だけ」だけにする
            "post_seasonal_note": f"{periods.pop()}の今だけ" if len(periods) == 1 else "今だけ",
        },
    )


def _recent_row(measurement):
    """「最近の記録」の1行分。タイトルはタグ → バッジ名の順で決める（どちらも無い記録は index() で除いている）。"""
    badges = list(measurement.badges.all())
    best = max(badges, key=lambda b: b.badge_type.strength).badge_type if badges else None
    tags = [tag.name for tag in measurement.tags.all()]
    return {
        "measurement": measurement,
        "title": "・".join(tags) or (best.name if best else "タグなし"),
        "badge": best,  # バッジの見た目は templates/components/badge.html に best.code を渡して描く
    }


def mypage(request):
    """マイページ。数字のまとめ、集めたバッジ（時間帯で絞り込める）、季節タグ図鑑を出す。"""
    user = request.user
    if not user.is_authenticated:
        # 見えないアカウントのミドルウェアが作るので、ふつうは来ない
        return redirect("/")

    # --- 集めたバッジ：「バッジの種類 × 時間帯」ごとに何個取ったか。取ったものだけ並べる ---
    counts = Counter(
        (ub.badge_type.code, ub.time_band_id)
        for ub in UserBadge.objects.filter(user=user).select_related("badge_type")
    )
    bands = list(TimeBand.objects.all())  # 今は使っていない時間帯で取ったバッジも数える
    most = max(counts.values(), default=1)  # 棒グラフは一番多いものを100%にする
    badge_rows = [
        {
            "code": code,
            "label": BADGE_LABELS[code],
            "band": band,
            "count": counts[(code, band.id)],
            "rare": (code, band.code) in RARE,
            "percent": round(counts[(code, band.id)] / most * 100),
        }
        for code in BADGE_CODES  # 並びは 90dB → 80dB → 70dB → 静寂 → 深い静寂、その中で時間帯の順
        for band in bands
        if counts[(code, band.id)]
    ]
    badge_total = sum(counts.values())

    # --- 季節タグ図鑑：自分の測定に付けたことのある季節タグが「登録済み」 ---
    collected = set(
        MeasurementTag.objects.filter(
            measurement__user=user, tag__tag_type=Tag.TagType.SEASONAL
        ).values_list("tag_id", flat=True)
    )
    seasonal = [
        {"tag": tag, "collected": tag.id in collected, "now": tag.is_available()}
        for tag in Tag.objects.filter(tag_type=Tag.TagType.SEASONAL, is_active=True)
    ]

    return render(
        request,
        "mypage.html",
        {
            "title": "マイページ",
            "badge_rows": badge_rows,
            "badge_total": badge_total,
            # 絞り込みのタブ（すべて／昼／夜）。管理画面で時間帯を足すとタブも増える
            "band_tabs": [band for band in bands if band.is_active],
            "seasonal": seasonal,
            "seasonal_collected": sum(s["collected"] for s in seasonal),
            # 「調査回数」は測定記録の数（10秒ごとの区間1つで1回）
            "survey_count": user.measurements.count(),
        },
    )


def health(request):
    """動作確認用。

    AWSやNginxが「アプリが生きているか」を定期的に確認しに来る先。
    開発中も「画面が出ない…アプリ自体は動いてる?」の切り分けに使える。
    """
    return JsonResponse({"status": "ok"})


def map_view(request):
    """マップ。ローカル（自分）／全国（みんな）を切り替え、時間帯で絞り込む。

    地図の処理は static/js/map.js、画面の操作は static/js/map_page.js。
    """
    bands = list(TimeBand.objects.filter(is_active=True))
    now_band = TimeBand.for_datetime(timezone.now())
    return render(
        request,
        "map.html",
        {
            "title": "マップ",
            "bands": bands,
            # 最初に選んでおく時間帯は「今」の時間帯
            "current_band_id": now_band.id if now_band else None,
        },
    )
