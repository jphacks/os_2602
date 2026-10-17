"""バッジ判定と50mルール（③データ担当）

使い方（測定APIの中で）:
    measurement = Measurement.objects.create(user=request.user, ...)
    new_badges = award_badges(measurement)   # ← 獲得したバッジのリスト。空ならバッジなし
"""

import math
from decimal import Decimal

from django.db import transaction

from .models import BadgeType, UserBadge

RADIUS_M = 50
# 1回の測定でもらえるバッジ：True = 系統ごとに一番強いものだけ / False = 条件を満たしたもの全部
ONLY_STRONGEST = True

# 50m を緯度経度の差に直した目安（日本付近）。まずこの四角で絞ってから正確な距離を計算する
_LAT_MARGIN = Decimal("0.00046")
_LNG_MARGIN = Decimal("0.00056")


def distance_m(lat1, lng1, lat2, lng2):
    """2点間の距離（メートル）"""
    r = 6_371_000
    p1, p2 = math.radians(float(lat1)), math.radians(float(lat2))
    dp = p2 - p1
    dl = math.radians(float(lng2) - float(lng1))
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@transaction.atomic
def award_badges(measurement):
    """測定記録からバッジを判定して UserBadge を作り、50mルールを適用する"""
    if measurement.time_band_id is None:
        return []  # どの時間帯にも入らない時刻なら判定しない

    hits = BadgeType.satisfied_by(measurement.avg_db, measurement.duration_seconds)
    if ONLY_STRONGEST:
        best = {}
        for b in hits:  # 強い順に並んでいるので、系統ごとに最初の1つだけ残す
            best.setdefault(b.category, b)
        hits = list(best.values())

    created = []
    for badge_type in hits:
        ub = UserBadge.objects.create(
            user=measurement.user,
            badge_type=badge_type,
            time_band=measurement.time_band,
            measurement=measurement,
            acquired_at=measurement.measured_at,
        )
        apply_50m_rule(ub)
        created.append(ub)
    return created


def apply_50m_rule(new_badge):
    """自分のローカルマップで、同じ系統・同じ時間帯・半径50m以内なら強いほうだけ表示する
    弱いほうは show_on_map=False にするだけで、記録は消さない"""
    m = new_badge.measurement
    neighbors = (
        UserBadge.objects.filter(
            user=new_badge.user,
            time_band=new_badge.time_band,
            badge_type__category=new_badge.badge_type.category,
            show_on_map=True,
            measurement__latitude__range=(m.latitude - _LAT_MARGIN, m.latitude + _LAT_MARGIN),
            measurement__longitude__range=(m.longitude - _LNG_MARGIN, m.longitude + _LNG_MARGIN),
        )
        .exclude(pk=new_badge.pk)
        .select_related("badge_type", "measurement")
    )

    near = [
        old
        for old in neighbors
        if distance_m(m.latitude, m.longitude, old.measurement.latitude, old.measurement.longitude) <= RADIUS_M
    ]
    new_strength = new_badge.badge_type.strength

    if any(old.badge_type.strength >= new_strength for old in near):
        # 近くにもっと強い（か同じ）バッジがある → 新しいほうを隠す
        new_badge.show_on_map = False
        new_badge.save(update_fields=["show_on_map"])
        return

    # 新しいほうが一番強い → 近くの弱いバッジを全部隠す（デモの「上書き」）
    UserBadge.objects.filter(pk__in=[old.pk for old in near]).update(show_on_map=False)
