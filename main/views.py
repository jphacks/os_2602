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

from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone

from main.legend_data import LEGENDS
from main.models import MeasurementTag, Tag, TimeBand, UserBadge

# 調査ページの「最近の記録」に出す件数（static/js/survey_page.js の RECENT_MAX と同じ）
RECENT_COUNT = 3

# マイページのバッジの並びと名前（static/js/badge.js の CODES / NAMES と同じ）
BADGE_CODES = ["b90", "b80", "b70", "q40", "q35"]
BADGE_LABELS = {"b90": "90dB", "b80": "80dB", "b70": "70dB", "q40": "静寂", "q35": "深い静寂"}
# 企画書：昼の静寂・昼の深い静寂・夜の90dBはレア（badge.js の RARE と同じ）
RARE = {("q40", "d"), ("q35", "d"), ("b90", "n")}

# マイページの図鑑のシートに出す言葉。取ったあとは説明、まだのときは取り方のヒント
BADGE_TEXT = {
    "b90": "電車の高架下や工事現場なみの、とても大きな音。長くいると耳を傷めることがあります。",
    "b80": "大通りの交差点や、にぎやかなお店の中くらいの大きな音。",
    "b70": "車の通る道ばたや、にぎやかな話し声くらいの音。",
    "q40": "図書館や、夜の住宅街くらいの静けさ。",
    "q35": "ささやき声より静かな、とても深い静けさ。なかなか出会えません。",
}
BADGE_HINT = {
    "b90": "90dB以上の音が10秒続く場所で",
    "b80": "80dB以上の音が10秒続く場所で",
    "b70": "70dB以上の音が10秒続く場所で",
    "q40": "40dB以下の静けさが15秒続く場所で",
    "q35": "33.5dB以下の静けさが15秒続く場所で",
}
# シートに並べる標本の数の上限（新しい順）
ZUKAN_ITEMS = 60
# 音の図鑑の1ページに並べるタグの数（横2 × 縦4）
ZUKAN_PAGE = 8


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
            # title は渡さない。トップなので、タブとSNSのカードはサイト名（dether）だけにする
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
    tags = list(measurement.tags.all())
    return {
        "measurement": measurement,
        "title": "・".join(t.name for t in tags) or (best.name if best else "タグなし"),
        "badge": best,  # バッジの見た目は templates/components/badge.html に best.code を渡して描く
        # バッジの無い記録（調査中の「直前の音を投稿」）は、1つ目のタグのメダルで出す
        "tag": tags[0].medal if tags and not best else None,
    }


def mypage(request):
    """マイページ。数字のまとめ、dBバッジ（時間帯で絞り込める）、音の図鑑を出す。

    どちらもカードを押すと「図鑑のシート」が開き、説明とこれまでの標本（音の模様入りのバッジ）が並ぶ。
    シートの中身は zukan_data にまとめて渡し、static/js/mypage.js が描く。
    """
    user = request.user
    if not user.is_authenticated:
        # 見えないアカウントのミドルウェアが作るので、ふつうは来ない
        return redirect("/")

    bands = list(TimeBand.objects.all())  # 今は使っていない時間帯で取ったバッジも出す
    zukan_data = {}  # シートの中身。キーはカードの data-key

    # --- dBバッジ：「バッジの種類 × 時間帯」の10枠を全部並べる（取っていない枠は鍵つき） ---
    user_badges = (
        UserBadge.objects.filter(user=user)
        .select_related("badge_type", "time_band", "measurement")
        .prefetch_related("measurement__tags")
        .order_by("-acquired_at")
    )
    by_slot = {}
    for ub in user_badges:
        by_slot.setdefault((ub.badge_type.code, ub.time_band_id), []).append(ub)

    badge_cards = []
    for code in BADGE_CODES:  # 並びは 90dB → 80dB → 70dB → 静寂 → 深い静寂、その中で時間帯の順
        for band in bands:
            got = by_slot.get((code, band.id), [])
            if not got and not band.is_active:
                continue
            key = f"b-{code}-{band.id}"
            rare = (code, band.code) in RARE
            card = {
                "key": key,
                "code": code,
                "label": BADGE_LABELS[code],
                "band": band,
                "count": len(got),
                "rare": rare,
            }
            badge_cards.append(card)
            zukan_data[key] = {
                "kind": "badge",
                "code": code,
                "band": band.code,
                "title": BADGE_LABELS[code],
                "chips": [band.name] + (["レア！"] if rare else []),
                "count": len(got),
                "text": BADGE_TEXT[code] if got else f"{band.name}に、{BADGE_HINT[code]}",
                "items": [_specimen(ub) for ub in got[:ZUKAN_ITEMS]],
            }
    badge_total = len(user_badges)

    # --- 音の図鑑：共通タグも季節タグも混ぜて、番号を付けて並べる ---
    #   自分の測定に付けたことのあるタグが「出会った」。まだのものは「？？？」とヒント
    tagged = (
        MeasurementTag.objects.filter(measurement__user=user)
        .select_related("measurement__time_band")
        .prefetch_related("measurement__badges__badge_type", "measurement__tags")
        .order_by("-measurement__measured_at")
    )
    by_tag = {}
    for mt in tagged:
        by_tag.setdefault(mt.tag_id, []).append(mt.measurement)

    tag_cards = []
    for number, tag in enumerate(Tag.objects.filter(is_active=True), start=1):
        met = by_tag.get(tag.id, [])
        key = f"t-{tag.id}"
        seasonal = tag.tag_type == Tag.TagType.SEASONAL
        card = {
            "key": key,
            "tag": tag,
            "color": tag.medal["color"],
            "number": number,
            "icon": tag.icon or tag.name[:1],
            "count": len(met),
            "collected": bool(met),
            "now": seasonal and tag.is_available(),
        }
        tag_cards.append(card)
        chips = []
        if tag.is_rare:
            chips.append("レア！")
        if seasonal:
            chips.append(tag.period_label or "期間限定")
        zukan_data[key] = {
            "kind": "tag",
            "number": number,
            "icon": card["icon"],
            # badge.js の tagMedal() に渡す { name, icon, color }。出会う前は名前とアイコンを隠す
            "tag": tag.medal if met else {**tag.medal, "name": "？？？", "icon": "?"},
            # まだ出会っていないものは、名前も説明も渡さない（ページのソースから分からないように）
            "title": tag.name if met else "？？？",
            "chips": chips,
            "count": len(met),
            "text": (tag.description or "説明はまだありません") if met else tag.hint_text,
            "items": [_specimen_of(m) for m in met[:ZUKAN_ITEMS]],
        }

    # --- 音の図鑑のページ（8個ずつ。mypage.js が横にめくる） ---
    tag_pages = [tag_cards[i : i + ZUKAN_PAGE] for i in range(0, len(tag_cards), ZUKAN_PAGE)]

    # --- レジェンド：決められたタグを全部集めると解放（main/legend_data.py） ---
    met_names = {c["tag"].name: c["tag"] for c in tag_cards if c["collected"]}
    all_tags = {c["tag"].name: c["tag"] for c in tag_cards}
    legend_cards = []
    for legend in LEGENDS:
        reqs = []
        for name in legend["requires"]:
            tag = all_tags.get(name)
            got = name in met_names
            reqs.append(
                {
                    "got": got,
                    # まだのタグは名前もアイコンも隠す（図鑑と同じ）
                    "tag": {
                        "name": name if got else "？？？",
                        "icon": (tag.medal["icon"] if tag else name[:1]) if got else "?",
                        "color": tag.medal["color"] if tag else "sage",
                    },
                }
            )
        have = sum(r["got"] for r in reqs)
        unlocked = have == len(reqs)
        key = f"l-{legend['key']}"
        # 名前は解放するまで隠す（ヒントと必要な音を手がかりに集める）。ページのソースにも出さない
        name = legend["name"] if unlocked else "？？？"
        medal = {"name": name, "icon": legend["icon"] if unlocked else "?", "color": "legend"}
        legend_cards.append(
            {
                "key": key,
                "name": name,
                "hint": legend["hint"],
                "icon": legend["icon"],
                "unlocked": unlocked,
                "have": have,
                "need": len(reqs),
                "reqs": reqs,
            }
        )
        zukan_data[key] = {
            "kind": "legend",
            "tag": medal,
            "title": name,
            "chips": ["レジェンド"],
            "count": 1 if unlocked else 0,
            "have": have,
            "need": len(reqs),
            "text": legend["description"] if unlocked else legend["hint"],
            "reqs": reqs,
            "items": [],
        }

    return render(
        request,
        "mypage.html",
        {
            "title": "マイページ",
            "badge_cards": badge_cards,
            "badge_total": badge_total,
            # 絞り込みのタブ（すべて／昼／夜）。管理画面で時間帯を足すとタブも増える
            "band_tabs": [band for band in bands if band.is_active],
            "tag_cards": tag_cards,
            "tag_pages": tag_pages,
            "legend_cards": legend_cards,
            "tag_collected": sum(c["collected"] for c in tag_cards),
            # 「調査回数」は測定記録の数（10秒ごとの区間1つで1回）
            "survey_count": user.measurements.count(),
            "zukan_data": zukan_data,
        },
    )


def _specimen(user_badge):
    """図鑑のシートに並べる標本1つ分（獲得したバッジ1つ）"""
    m = user_badge.measurement
    return {
        "code": user_badge.badge_type.code,
        "band": user_badge.time_band.code,
        "spectrum": m.spectrum,  # 音の形。badge.js の medal(..., { spectrum }) で模様になる
        "at": _when(m.measured_at),
        "avg_db": round(float(m.avg_db), 1),
        "tags": [t.name for t in m.tags.all()],
    }


def _specimen_of(measurement):
    """タグを付けた測定1つ分。見た目はそのタグのメダル（mypage.js）に、この測定の音の模様を描く"""
    badges = list(measurement.badges.all())
    best = max(badges, key=lambda b: b.badge_type.strength) if badges else None
    return {
        "code": best.badge_type.code if best else None,
        "band": measurement.time_band.code if measurement.time_band_id else None,
        "spectrum": measurement.spectrum,
        "at": _when(measurement.measured_at),
        "avg_db": round(float(measurement.avg_db), 1),
        "tags": [t.name for t in measurement.tags.all()],
    }


def _when(dt):
    """2026/10/17 14:05 の形（%-m は Windows で使えないので自分で組み立てる）"""
    t = timezone.localtime(dt)
    return f"{t.year}/{t.month}/{t.day} {t:%H:%M}"


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
