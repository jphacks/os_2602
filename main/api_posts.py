# =============================================================================
# api_posts.py = 投稿（音の内容を投稿）と、全国マップ（みんなの投稿）のAPI
#
# ▼ 投稿の流れ
#
#   調査ページでバッジを獲得 → 獲得ポップアップの「音の内容を投稿する」→ 投稿シート
#   調査中の「直前の音を投稿」→ 投稿シート（バッジの無い測定も投稿できる）
#   → static/js/survey_page.js が POST /api/posts に送る
#     （写真があるので JSON ではなくフォームの形）
#
#   1つの測定につき投稿は1件（models.py の Post）。バッジのある測定なら、そのバッジの投稿になる。
#   選んだタグは「測定記録のタグ」（MeasurementTag）として付ける。
#
# ▼ 写真
#
#   ★位置情報などが入った EXIF は、Pillow で画像を描き直して必ず消す（企画書）。
#   ついでに長い辺を MAX_PHOTO_SIDE に縮め、ファイル名もランダムにする（元のファイル名を残さない）。
#
# ▼ 全国マップ
#
#   GET /api/badges/everyone/
#     見えている範囲の「投稿のある」バッジを、全員分返す。
#   投稿していない記録は場所を出さない（自宅などを知られないように）。
#   ローカルマップ（自分のバッジ）は api_badges.py。
#   ピン1つ分の形は、バッジなら post_badge_dict()、
#   バッジの無い投稿なら tag_post_dict()（タグのメダルで出す）。
# =============================================================================

import uuid
from io import BytesIO

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.views.decorators.http import require_http_methods
from PIL import Image, ImageOps, UnidentifiedImageError

from main.api import json_response
from main.models import BadgeType, Measurement, MeasurementTag, Post, Tag, UserBadge

# --- 調整する数値はここだけ -------------------------------------------------
MAX_DESCRIPTION = 200  # 内容の文字数の上限
MAX_TAGS = 10  # 一度に付けられるタグの数
# 受け取る写真の大きさの上限（settings の DATA_UPLOAD_MAX_MEMORY_SIZE より小さく）
MAX_PHOTO_BYTES = 15 * 1024 * 1024
MAX_PHOTO_SIDE = 1600  # 保存する写真の長い辺（px）
MAX_BADGES = 500  # 全国マップで1回に返す上限（api_badges.py と同じ）


@require_http_methods(["POST"])
def create_post(request):
    """POST /api/posts（フォームの形）

    user_badge_id  … どの獲得バッジの投稿か（測定APIの返事の badge.user_badge_id）
    measurement_id … バッジの無い測定に投稿するとき（測定APIの返事の measurement.id）
                     ★どちらか1つ。バッジのある測定の measurement_id なら、そのバッジの投稿にする
    tag_ids        … 選んだタグのID。複数なら同じ名前で何個も送る。1つ以上必須
    description   … 内容（任意）
    photo         … 写真（任意）
    """
    if not request.user.is_authenticated:
        return json_response({"error": "もう一度ページを開き直してください。"}, status=401)

    # --- どの測定の投稿か（自分の測定だけ） ---
    try:
        if request.POST.get("user_badge_id"):
            user_badge = UserBadge.objects.select_related("measurement").get(
                pk=int(request.POST["user_badge_id"]), user=request.user
            )
            measurement = user_badge.measurement
        else:
            measurement = Measurement.objects.get(
                pk=int(request.POST.get("measurement_id", "")), user=request.user
            )
            # バッジのある測定なら、一番強いバッジの投稿にする（地図にバッジとして出る）
            badges = list(measurement.badges.select_related("badge_type"))
            user_badge = max(badges, key=lambda b: b.badge_type.strength) if badges else None
    except (ValueError, UserBadge.DoesNotExist, Measurement.DoesNotExist):
        return json_response({"error": "投稿する記録が見つかりません。"}, status=404)
    if Post.objects.filter(
        Q(measurement=measurement) | Q(user_badge__measurement=measurement)
    ).exists():
        return json_response({"error": "この記録はもう投稿済みです。"}, status=409)

    # --- タグ（今選べるものだけ） ---
    try:
        tag_ids = {int(v) for v in request.POST.getlist("tag_ids")}
    except ValueError:
        return json_response({"error": "タグの指定が正しくありません。"}, status=400)
    if not tag_ids:
        return json_response({"error": "何の音だったか、タグを1つ以上選んでください。"}, status=400)
    if len(tag_ids) > MAX_TAGS:
        return json_response({"error": f"タグは{MAX_TAGS}個までです。"}, status=400)
    available = {tag.id: tag for tag in Tag.available()}
    if not tag_ids <= available.keys():
        return json_response({"error": "今は選べないタグが含まれています。"}, status=400)

    # --- 内容 ---
    description = request.POST.get("description", "").strip()
    if len(description) > MAX_DESCRIPTION:
        return json_response({"error": f"内容は{MAX_DESCRIPTION}文字までです。"}, status=400)

    # --- 写真（EXIF を消して描き直す） ---
    photo = None
    upload = request.FILES.get("photo")
    if upload:
        if upload.size > MAX_PHOTO_BYTES:
            return json_response({"error": "写真が大きすぎます（15MBまで）。"}, status=400)
        try:
            photo = clean_photo(upload)
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            message = "この写真は読み込めませんでした（JPEG・PNG が使えます）。"
            return json_response({"error": message}, status=400)

    with transaction.atomic():
        post = Post(user_badge=user_badge, measurement=measurement, description=description)
        if photo:
            post.photo.save(f"{uuid.uuid4().hex}.jpg", photo, save=False)
        post.save()
        for tag_id in tag_ids:
            MeasurementTag.objects.get_or_create(measurement=measurement, tag=available[tag_id])

    if user_badge:
        pin = post_badge_dict(with_post_data(UserBadge.objects).get(pk=user_badge.pk), request.user)
    else:
        pin = tag_post_dict(with_tag_post_data(Post.objects).get(pk=post.pk), request.user)
    return json_response({"badge": pin}, status=201)


def clean_photo(upload) -> ContentFile:
    """写真を描き直して、EXIF（位置情報・撮影日時・機種など）を残さない JPEG にする"""
    with Image.open(upload) as img:
        # 向きの情報だけは先に反映しておく（消すと横倒しになるため）
        img = ImageOps.exif_transpose(img)
        img.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE))
        img = img.convert("RGB")
        buf = BytesIO()
        # exif を渡さないので、何も書き込まれない
        img.save(buf, "JPEG", quality=85, optimize=True)
    return ContentFile(buf.getvalue())


@require_http_methods(["GET"])
def everyone_badges(request):
    """GET /api/badges/everyone/?south=..&west=..&north=..&east=..&time_band=1

    全国マップ用。全員の「投稿のある」バッジを返す（形は api_badges.my_badges と同じ）。
    """
    from main.api_badges import _float, _optional_int  # 範囲の読み取りはローカルマップと同じ

    try:
        south = _float(request.GET, "south", -90, 90)
        north = _float(request.GET, "north", -90, 90)
        west = _float(request.GET, "west", -180, 180)
        east = _float(request.GET, "east", -180, 180)
        time_band = _optional_int(request.GET, "time_band")
    except ValueError as e:
        return json_response({"error": str(e)}, status=400)

    badges = with_post_data(
        UserBadge.objects.filter(
            post__isnull=False,
            measurement__latitude__range=(south, north),
            measurement__longitude__range=(west, east),
        ).order_by("-acquired_at")
    )
    if time_band is not None:
        badges = badges.filter(time_band_id=time_band)
    seasonal = wants_seasonal(request)
    if not seasonal:
        badges = badges.exclude(SEASONAL_MEASUREMENT)
    pins = [post_badge_dict(ub, request.user) for ub in badges[:MAX_BADGES]]
    pins += tag_post_pins(
        Q(), (south, north, west, east), time_band, request.user, MAX_BADGES - len(pins), seasonal
    )
    return json_response({"badges": pins})


# 季節タグ（セミ・祭り・音楽フェスなど、その時期だけの音）が付いた測定。
# 地図の「季節の音」を消したときは、これに当てはまるバッジ・投稿・ヒートマップの記録を外す
SEASONAL_MEASUREMENT = Q(measurement__tags__tag_type=Tag.TagType.SEASONAL)


def wants_seasonal(request) -> bool:
    """?seasonal=0 なら、季節タグの付いた記録を外す（地図の「季節の音」ボタン）。省略なら含める"""
    return request.GET.get("seasonal") != "0"


def tag_post_pins(where, box, time_band, viewer, limit, seasonal=True):
    """バッジの無い投稿（タグのメダルで出す）のピン。

    where で絞る（ローカルマップなら自分の投稿だけ）。
    seasonal=False なら季節タグの付いた投稿を外す。
    """
    if limit <= 0:
        return []
    south, north, west, east = box
    posts = with_tag_post_data(
        Post.objects.filter(
            where,
            user_badge__isnull=True,
            measurement__latitude__range=(south, north),
            measurement__longitude__range=(west, east),
        ).order_by("-created_at")
    )
    if time_band is not None:
        posts = posts.filter(measurement__time_band_id=time_band)
    if not seasonal:
        posts = posts.exclude(SEASONAL_MEASUREMENT)
    return [tag_post_dict(p, viewer) for p in posts[:limit]]


def with_tag_post_data(queryset):
    """tag_post_dict() に必要なものを、まとめて読み込んでおく"""
    return queryset.select_related("measurement__time_band").prefetch_related("measurement__tags")


def tag_post_dict(post: Post, viewer=None) -> dict:
    """バッジの無い投稿のピン1つ分。形は post_badge_dict() とそろえ、kind と tag が違う

    見た目は、付けたタグの1つ目（図鑑の並び順で先のもの）のメダル。
    """
    m = post.measurement
    tags = list(m.tags.all())
    main_tag = tags[0] if tags else None
    band = m.time_band
    return {
        "id": f"p{post.id}",  # バッジのピンの id（数字）とぶつからないように
        "kind": "tag",
        "lat": float(m.latitude),
        "lng": float(m.longitude),
        "name": main_tag.name if main_tag else "投稿",
        "code": None,
        "tag": main_tag.medal if main_tag else {"name": "投稿", "icon": "音", "color": "sage"},
        "rare_tag": bool(main_tag and main_tag.is_rare),
        "time_band": m.time_band_id,
        "time_band_name": band.name if band else "",
        "time_band_code": band.code if band else None,
        "avg_db": float(m.avg_db),
        "max_db": float(m.max_db),
        "measured_at": m.measured_at.isoformat(),
        "spectrum": m.spectrum,
        "mine": viewer is not None and m.user_id == viewer.id,
        "tags": [{"id": t.id, "name": t.name, "icon": tag_icon(t)} for t in tags],
        "post": {
            "description": post.description,
            "photo": post.photo.url if post.photo else None,
            "created_at": post.created_at.isoformat(),
        },
    }


def with_post_data(queryset):
    """post_badge_dict() に必要なものを、まとめて読み込んでおく（1件ずつDBに聞かないように）"""
    return queryset.select_related(
        "badge_type", "time_band", "measurement", "post"
    ).prefetch_related("measurement__tags")


def post_badge_dict(ub: UserBadge, viewer=None) -> dict:
    """地図のピンと、ピンを押したときのシートに出す中身。

    ★名前（ユーザー名）は返さない。見えないアカウントなので、誰の投稿かは出さない。
    """
    bt = ub.badge_type
    m = ub.measurement
    # 投稿が無ければ None（OneToOne の逆向きは、無いと例外になるため getattr で受ける）
    post = getattr(ub, "post", None)
    return {
        "id": ub.id,
        "kind": "badge",
        "lat": float(m.latitude),
        "lng": float(m.longitude),
        "name": bt.name,
        "code": bt.code,  # b90 / b80 / b70 / q40 / q35（badge.js の部品にそのまま渡せる）
        "system": "loud" if bt.category == BadgeType.Category.LOUD else "quiet",
        "threshold_db": float(bt.threshold_db),
        "time_band": ub.time_band_id,  # TimeBand.id
        "time_band_name": ub.time_band.name,
        "time_band_code": ub.time_band.code,  # "d"（昼）/ "n"（夜）。レアの判定に使う
        "avg_db": float(m.avg_db),
        "max_db": float(m.max_db),
        "measured_at": m.measured_at.isoformat(),
        "spectrum": m.spectrum,  # 音の形（badge.js の medal の opt.spectrum に渡す）。古い記録は null
        "mine": viewer is not None and ub.user_id == viewer.id,
        "tags": [{"id": t.id, "name": t.name, "icon": tag_icon(t)} for t in m.tags.all()],
        "post": (
            {
                "description": post.description,
                "photo": post.photo.url if post.photo else None,
                "created_at": post.created_at.isoformat(),
            }
            if post
            else None
        ),
    }


def tag_icon(tag: Tag) -> str:
    """タグの丸いアイコンに出す1文字。管理画面の「アイコン」が空なら名前の1文字目"""
    return tag.icon or tag.name[:1]
