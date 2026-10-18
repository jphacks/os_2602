# =============================================================================
# api_heatmap.py = ヒートマップの集計API
#
# ▼ やること
#
#   地図に見えている範囲の測定記録を、マスごとにまとめて返す。
#   マスごとの平均dBで色を塗り、一番多く付けられたタグ（代表タグ）のアイコンを重ねる（企画書）。
#
# ▼ マスの大きさは、拡大率に関係なくいつでも約50m（main/models.py の CELL_LEVELS["50m"]）
#
#   縮小するほどマスが小さく見えて、全体がなめらかに見える（リーダーの案）。
#   保存している約10mのマス（cell_x / cell_y）を 5×5 個まとめたもの。
#
# ▼ 屋外／屋内（Measurement.is_indoor）
#
#   マスごとに「全部の平均」と「屋外だけの平均」を返す。
#   地図側（static/js/map.js）は、屋外の記録だけを近くのマスになじませ、
#   屋内の記録はそのマスだけに出す。
#
# ▼ 送受信の形は docs/API_heatmap.md を正とする
# =============================================================================

import math

from django.db.models import Avg, Count, F, Q
from django.db.models.functions import Floor
from django.views.decorators.http import require_http_methods

from main.api import json_response
from main.models import (
    CELL_LEVELS,
    CELLS_PER_DEG_LAT,
    CELLS_PER_DEG_LNG,
    Measurement,
    MeasurementTag,
    Tag,
)

# --- 調整する数値はここだけ -------------------------------------------------
MAX_CELLS = 8000  # 1回に返すマスの上限（画面が重くならないように）。超えたら truncated
CELL_LEVEL = "50m"  # マスの大きさ（main/models.py の CELL_LEVELS のどれか）
# 1つのマスを出すのに必要な人数。1 = 制限なし。
# ★企画書の「自宅を特定させない」に合わせるなら 2 や 3 にする（1人しか測っていないマスは出さない）
MIN_USERS = 1


@require_http_methods(["GET"])
def heatmap(request):
    """見えている範囲の、マスごとの平均dBと代表タグを返す。

    GET /api/heatmap?south=..&west=..&north=..&east=..&time_band=1&mine=1
    mine=1 なら自分の測定だけ（ローカルマップ）。無ければ全員分（全国マップ）
    zoom を送ってきても使わない（マスはいつでも約50m）
    """
    try:
        south = _float(request.GET, "south", -90, 90)
        north = _float(request.GET, "north", -90, 90)
        west = _float(request.GET, "west", -180, 180)
        east = _float(request.GET, "east", -180, 180)
        time_band = _optional_int(request.GET, "time_band", 1, 2**31 - 1)
    except ValueError as e:
        return json_response({"error": str(e)}, status=400)
    if south >= north or west >= east:
        return json_response({"error": "表示範囲の指定が正しくありません。"}, status=400)

    k = CELL_LEVELS[CELL_LEVEL]

    # 範囲を10mのマスの番号に直す。端のマスが欠けないよう、50mのマスの境目まで広げる
    x0 = math.floor(west * CELLS_PER_DEG_LNG) // k * k
    x1 = math.floor(east * CELLS_PER_DEG_LNG) // k * k + (k - 1)
    y0 = math.floor(south * CELLS_PER_DEG_LAT) // k * k
    y1 = math.floor(north * CELLS_PER_DEG_LAT) // k * k + (k - 1)

    measurements = Measurement.objects.filter(cell_x__range=(x0, x1), cell_y__range=(y0, y1))
    if time_band is not None:
        measurements = measurements.filter(time_band_id=time_band)
    if request.GET.get("seasonal") == "0":
        # 地図の「季節の音」を消したとき：
        # 季節タグ（セミ・祭りなど、その時期だけの音）の付いた記録を外す
        measurements = measurements.exclude(tags__tag_type=Tag.TagType.SEASONAL)
    if request.GET.get("mine") == "1":
        # 見えないアカウントがまだ無い人は、自分の測定も無い
        user_id = request.user.id if request.user.is_authenticated else None
        measurements = measurements.filter(user_id=user_id)

    # --- マスごとの平均dB（全部と、屋外だけ） ---
    outdoor = Q(is_indoor=False)
    cells = (
        measurements.annotate(gx=_group(F("cell_x"), k), gy=_group(F("cell_y"), k))
        .values("gx", "gy")
        .annotate(
            # ★集計の名前を列の名前（avg_db）と同じにすると、次の Avg("avg_db") が集計を指してしまう
            db_all=Avg("avg_db"),
            count=Count("id"),
            db_out=Avg("avg_db", filter=outdoor),
            out_count=Count("id", filter=outdoor),
            users=Count("user", distinct=True),
        )
        .order_by("-count")  # 上限で打ち切るときは、測定の多いマスを残す
    )
    if MIN_USERS > 1:
        cells = cells.filter(users__gte=MIN_USERS)
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

    result = []
    for c in cells:
        gx, gy = int(c["gx"]), int(c["gy"])
        tag = top_tag.get((gx, gy))
        result.append(
            {
                # マスの番号。四隅は x * cell_deg.lng（西端）, y * cell_deg.lat（南端）で出せる
                "x": gx,
                "y": gy,
                "avg_db": round(float(c["db_all"]), 1),
                "count": c["count"],
                # 屋外だけの平均。屋外の記録が無いマス（屋内の記録だけ）は null
                "out_db": round(float(c["db_out"]), 1) if c["db_out"] is not None else None,
                "out_count": c["out_count"],
                "tag": (
                    {"id": tag["tag_id"], "name": tag["tag__name"], "icon": tag["tag__icon"]}
                    if tag
                    else None
                ),
            }
        )

    return json_response(
        {
            "level": CELL_LEVEL,
            # マス1つの大きさ（度）。地図側はこれと x, y からマスの四隅を出す
            "cell_deg": {
                "lat": round(k / CELLS_PER_DEG_LAT, 9),
                "lng": round(k / CELLS_PER_DEG_LNG, 9),
            },
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
