# =============================================================================
# api_badges.py = 自分の獲得バッジを地図に出すためのAPI（ローカルマップ用）
#
# ▼ やること
#
#   見えている範囲にある、自分のバッジのうち「地図に表示する」ものを返す。
#   50mルールで隠れたバッジ（show_on_map=False）は返さない（企画書：ローカルマップは50mルール適用後）。
#   ★ただし投稿したバッジは、隠れていても返す（投稿が地図から消えないように）。
#   返す形は全国マップ（api_posts.everyone_badges）と同じ。投稿とタグも付ける（api_posts.post_badge_dict）。
#
# ▼ 受け取る側は static/js/map.js（DetherMap._fetchBadges）。形はそこに合わせている
# =============================================================================

from django.db.models import Q
from django.views.decorators.http import require_http_methods

from main.api import json_response
from main.api_posts import post_badge_dict, with_post_data
from main.models import UserBadge

MAX_BADGES = 500  # 1回に返す上限（画面が重くならないように）


@require_http_methods(["GET"])
def my_badges(request):
    """GET /api/badges/mine/?south=..&west=..&north=..&east=..&time_band=1"""
    if not request.user.is_authenticated:
        # 見えないアカウントは地図のページを開いたときに作られるので、ふつうは来ない
        return json_response({"badges": []})

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
            Q(show_on_map=True) | Q(post__isnull=False),
            user=request.user,
            measurement__latitude__range=(south, north),
            measurement__longitude__range=(west, east),
        ).order_by("-acquired_at")
    )
    if time_band is not None:
        badges = badges.filter(time_band_id=time_band)

    return json_response(
        {"badges": [post_badge_dict(ub, request.user) for ub in badges[:MAX_BADGES]]}
    )


def _float(params, key: str, lo: float, hi: float) -> float:
    try:
        value = float(params[key])
    except (KeyError, ValueError):
        raise ValueError(f"{key} を数で指定してください。") from None
    if value != value or not (lo <= value <= hi):  # value != value は NaN の判定
        raise ValueError(f"{key} の値が範囲外です。")
    return value


def _optional_int(params, key: str) -> int | None:
    raw = params.get(key)
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"{key} は整数で指定してください。") from None
