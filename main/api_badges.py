# =============================================================================
# api_badges.py = 自分の獲得バッジを地図に出すためのAPI（ローカルマップ用）
#
# ▼ やること
#
#   見えている範囲にある、自分のバッジのうち「地図に表示する」ものを返す。
#   50mルールで隠れたバッジ（show_on_map=False）は返さない（企画書：ローカルマップは50mルール適用後）。
#
# ▼ 受け取る側は static/js/map.js（DetherMap._fetchBadges）。形はそこに合わせている
# =============================================================================

from django.views.decorators.http import require_http_methods

from main.api import json_response
from main.models import BadgeType, UserBadge

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

    badges = (
        UserBadge.objects.filter(
            user=request.user,
            show_on_map=True,
            measurement__latitude__range=(south, north),
            measurement__longitude__range=(west, east),
        )
        .select_related("badge_type", "time_band", "measurement")
        .order_by("-acquired_at")
    )
    if time_band is not None:
        badges = badges.filter(time_band_id=time_band)

    return json_response({"badges": [_badge_dict(ub) for ub in badges[:MAX_BADGES]]})


def _badge_dict(ub: UserBadge) -> dict:
    bt = ub.badge_type
    m = ub.measurement
    return {
        "id": ub.id,
        "lat": float(m.latitude),
        "lng": float(m.longitude),
        "name": bt.name,
        "code": bt.code,  # b90 / b80 / b70 / q40 / q35（badge.js の部品にそのまま渡せる）
        "system": "loud" if bt.category == BadgeType.Category.LOUD else "quiet",
        "threshold_db": float(bt.threshold_db),
        "time_band": ub.time_band_id,  # TimeBand.id
        "time_band_name": ub.time_band.name,  # 夜のピンの枠色に使う（map.css）
        "avg_db": float(m.avg_db),
        "measured_at": m.measured_at.isoformat(),
    }


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
