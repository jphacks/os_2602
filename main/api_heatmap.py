# =============================================================================
# api_heatmap.py = ヒートマップの集計API
#
# ▼ やること
#
#   地図に見えている範囲の測定記録を、マスごとにまとめて返す。
#   マスごとの平均dBで色を塗り、一番多く付けられたタグ（代表タグ）のアイコンを重ねる（企画書）。
#
# ▼ マスの大きさは地図の拡大率で3段階（main/models.py の CELL_LEVELS）
#
#   zoom 18以上 … 約10m（保存している cell_x / cell_y そのまま）
#   zoom 15〜17 … 約100m（標準の100mメッシュ。番号を10で割る）
#   zoom 14以下 … 約1km （標準の3次メッシュ。番号を100で割る）
#
# ▼ 送受信の形は docs/API_heatmap.md を正とする
# =============================================================================

import math

from django.db.models import Avg, Count, F
from django.db.models.functions import Floor
from django.views.decorators.http import require_http_methods

from main.api import json_response
from main.models import CELL_LEVELS, CELLS_PER_DEG_LAT, CELLS_PER_DEG_LNG, Measurement, MeasurementTag

# --- 調整する数値はここだけ -------------------------------------------------
MAX_CELLS = 3000  # 1回に返すマスの上限（画面が重くならないように）
# 10mのマスを出すのに必要な人数。1 = 制限なし。
# ★企画書の「自宅を特定させない」に合わせるなら 3 などにする（1人しか測っていない10mのマスは出さない）
FINE_MIN_USERS = 1


def level_for_zoom(zoom: int | None) -> str:
    """地図の拡大率 → マスの段階"""
    if zoom is None:
        return "100m"
    if zoom >= 18:
        return "10m"
    if zoom >= 15:
        return "100m"
    return "1km"


@require_http_methods(["GET"])
def heatmap(request):
    """見えている範囲のマスごとの平均dBと代表タグを返す。

    GET /api/heatmap?south=..&west=..&north=..&east=..&zoom=17&time_band=1&mine=1
    mine=1 なら自分の測定だけ（ローカルマップ）。無ければ全員分（全国マップ）
    """
    try:
        south = _float(request.GET, "south", -90, 90)
        north = _float(request.GET, "north", -90, 90)
        west = _float(request.GET, "west", -180, 180)
        east = _float(request.GET, "east", -180, 180)
        zoom = _optional_int(request.GET, "zoom", 0, 30)
        time_band = _optional_int(request.GET, "time_band", 1, 2**31 - 1)
    except ValueError as e:
        return json_response({"error": str(e)}, status=400)
    if south >= north or west >= east:
        return json_response({"error": "表示範囲の指定が正しくありません。"}, status=400)

    level = level_for_zoom(zoom)
    k = CELL_LEVELS[level]

    # 範囲を10mのマスの番号に直す。端のマスが欠けないよう、粗いマスの境目まで広げる
    x0 = math.floor(west * CELLS_PER_DEG_LNG) // k * k
    x1 = math.floor(east * CELLS_PER_DEG_LNG) // k * k + (k - 1)
    y0 = math.floor(south * CELLS_PER_DEG_LAT) // k * k
    y1 = math.floor(north * CELLS_PER_DEG_LAT) // k * k + (k - 1)

    measurements = Measurement.objects.filter(cell_x__range=(x0, x1), cell_y__range=(y0, y1))
    if time_band is not None:
        measurements = measurements.filter(time_band_id=time_band)
    if request.GET.get("mine") == "1":
        # 見えないアカウントがまだ無い人は、自分の測定も無い
        user_id = request.user.id if request.user.is_authenticated else None
        measurements = measurements.filter(user_id=user_id)

    # --- マスごとの平均dB ---
    cells = (
        measurements.annotate(gx=_group(F("cell_x"), k), gy=_group(F("cell_y"), k))
        .values("gx", "gy")
        .annotate(avg_db=Avg("avg_db"), count=Count("id"), users=Count("user", distinct=True))
        .order_by()
    )
    if level == "10m" and FINE_MIN_USERS > 1:
        cells = cells.filter(users__gte=FINE_MIN_USERS)
    cells = list(cells[: MAX_CELLS + 1])
    truncated = len(cells) > MAX_CELLS
    cells = cells[:MAX_CELLS]

    # --- マスごとの代表タグ（一番多く付けられたタグ） ---
    tag_counts = (
        MeasurementTag.objects.filter(measurement__in=measurements)
        .annotate(gx=_group(F("measurement__cell_x"), k), gy=_group(F("measurement__cell_y"), k))
        .values("gx", "gy", "tag_id", "tag__name", "tag__icon")
        .annotate(n=Count("id"))
        .order_by()
    )
    top_tag = {}
    for row in tag_counts:
        key = (int(row["gx"]), int(row["gy"]))
        if key not in top_tag or row["n"] > top_tag[key]["n"]:
            top_tag[key] = row

    lat_step = k / CELLS_PER_DEG_LAT
    lng_step = k / CELLS_PER_DEG_LNG
    result = []
    for c in cells:
        gx, gy = int(c["gx"]), int(c["gy"])
        tag = top_tag.get((gx, gy))
        result.append(
            {
                "x": gx,
                "y": gy,
                # 四角形の四隅（地図側はこのまま google.maps.Rectangle の bounds に渡せる）
                "south": round(gy * lat_step, 7),
                "west": round(gx * lng_step, 7),
                "north": round((gy + 1) * lat_step, 7),
                "east": round((gx + 1) * lng_step, 7),
                "avg_db": round(float(c["avg_db"]), 1),
                "count": c["count"],
                "tag": (
                    {"id": tag["tag_id"], "name": tag["tag__name"], "icon": tag["tag__icon"]} if tag else None
                ),
            }
        )

    return json_response(
        {
            "level": level,
            "cell_deg": {"lat": round(lat_step, 9), "lng": round(lng_step, 9)},
            "cells": result,
            "truncated": truncated,  # True なら上限で打ち切った（もっと拡大すると全部出る）
        }
    )


def _group(expr, k: int):
    """10mのマスの番号 → k個まとめた粗いマスの番号（k=1 ならそのまま）"""
    return expr if k == 1 else Floor(expr / k)


def _float(params, key: str, lo: float, hi: float) -> float:
    try:
        value = float(params[key])
    except (KeyError, ValueError):
        raise ValueError(f"{key} を数で指定してください。") from None
    if value != value or not (lo <= value <= hi):  # value != value は NaN の判定
        raise ValueError(f"{key} の値が範囲外です。")
    return value


def _optional_int(params, key: str, lo: int, hi: int) -> int | None:
    raw = params.get(key)
    if raw in (None, ""):
        return None
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{key} は整数で指定してください。") from None
    if not (lo <= value <= hi):
        raise ValueError(f"{key} の値が範囲外です。")
    return value
