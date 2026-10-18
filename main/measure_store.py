# =============================================================================
# measure_store.py = 測定まわりでDBに触る処理
#
# ▼ このファイルの約束
#
#   api_measure.py（①）はDBに直接触らず、ここの関数だけを呼ぶ。
#   モデル（main/models.py）と50mルール（main/badges.py）は③の担当。ここはそれを呼ぶだけ。
#
# ▼ DBにデータが無いとき
#
#   ・TimeBand が無い・どれにも入らない時刻 … 昼6〜22時 / 夜の直書きで返す。バッジは保存しない
#   ・BadgeType が1件も無い … 企画書の値で判定だけして返す。バッジは保存しない
#   どちらも管理画面から登録すれば保存されるようになる（⑥）
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from django.utils import timezone

from main.badges import apply_50m_rule
from main.models import BadgeType, Measurement, TimeBand, UserBadge

if TYPE_CHECKING:
    from main.api_measure import MeasurementInput


@dataclass(frozen=True)
class TimeBandInfo:
    """時間帯はDBに合わせて TimeBand.id で表す（地図の time_band と同じ）。name は表示用"""

    id: int | None  # TimeBand.id（DBに無い時刻なら None）
    name: str  # "昼" / "夜"
    code: str  # TimeBand.code の "d"（昼）/ "n"（夜）。画面のバッジ部品がレアの判定に使う


@dataclass(frozen=True)
class BadgeRule:
    """バッジ1種類の判定ルール（BadgeType 1行ぶん）。"""

    code: str  # b90 / b80 / b70 / q40 / q35（画面のバッジ部品と同じ）
    name: str
    series: str  # "loud"（大きい音）/ "quiet"（静寂）。measure.js の judge と同じ言葉
    threshold_db: float
    seconds: float  # 必要な継続秒数（判定の区間がこれ以上続いたこと）
    at_least: bool  # True = Leqが threshold_db 以上 / False = 以下
    badge_type_id: int | None = None  # BadgeType.id（DBに無いルールなら None。保存しない）


@dataclass(frozen=True)
class SavedBadge:
    user_badge_id: int | None  # 保存した UserBadge.id
    replaced: str | None  # 50mルールで地図から外れた自分のバッジのコード（例 "b70"）。無ければ None


# BadgeType が1件も無いときに使う企画書の値（強い順）
DEFAULT_RULES = [
    BadgeRule("q35", "深い静寂バッジ", "quiet", 33.5, 15.0, at_least=False),
    BadgeRule("q40", "静寂バッジ", "quiet", 40.0, 15.0, at_least=False),
    BadgeRule("b90", "90dBバッジ", "loud", 90.0, 10.0, at_least=True),
    BadgeRule("b80", "80dBバッジ", "loud", 80.0, 10.0, at_least=True),
    BadgeRule("b70", "70dBバッジ", "loud", 70.0, 10.0, at_least=True),
]


def get_time_band(measured_at: datetime) -> TimeBandInfo:
    """測った時刻の時間帯（TimeBand から引く。日またぎは TimeBand.contains が扱う）"""
    band = TimeBand.for_datetime(measured_at)
    if band is not None:
        return TimeBandInfo(id=band.id, name=band.name, code=band.code)
    # DBに時間帯が無い間の仮（保存はされない）。TimeBand.code と同じ決まり（昼 6:00〜22:00）
    if 6 <= timezone.localtime(measured_at).hour < 22:
        return TimeBandInfo(id=None, name="昼", code="d")
    return TimeBandInfo(id=None, name="夜", code="n")


def get_badge_rules() -> list[BadgeRule]:
    """バッジの判定ルール（強い順）。BadgeType が無ければ企画書の値"""
    rules = [
        BadgeRule(
            code=bt.code,
            name=bt.name,
            series="loud" if bt.category == BadgeType.Category.LOUD else "quiet",
            threshold_db=float(bt.threshold_db),
            seconds=float(bt.required_duration_seconds),
            at_least=bt.condition_operator == BadgeType.Operator.GTE,
            badge_type_id=bt.id,
        )
        # strength は同じ系統の中での強さ。判定は系統ごとに見るので、まとめて並べてよい
        for bt in sorted(BadgeType.objects.all(), key=lambda b: b.strength, reverse=True)
    ]
    return rules or DEFAULT_RULES


def save_measurement(user, m: MeasurementInput, time_band: TimeBandInfo) -> int | None:
    """測定記録を保存して id を返す。バッジにならなかった回も保存する（ヒートマップの材料）。
    マス目番号は Measurement.save() が計算する。"""
    measurement = Measurement.objects.create(
        user=user,
        latitude=Decimal(str(m.latitude)),
        longitude=Decimal(str(m.longitude)),
        gps_accuracy=Decimal(str(m.gps_accuracy)),
        avg_db=Decimal(str(m.avg_db)),
        max_db=Decimal(str(m.max_db)),
        duration_seconds=max(1, round(m.duration_seconds)),  # 列が整数なので四捨五入（判定は送られた値で済んでいる）
        spectrum=m.spectrum,
        is_indoor=m.indoor,
        time_band_id=time_band.id,
        measured_at=m.measured_at,
    )
    return measurement.id


def save_badge(
    user,
    measurement_id: int | None,
    rule: BadgeRule,
    time_band: TimeBandInfo,
    m: MeasurementInput,
) -> SavedBadge:
    """獲得バッジを保存し、50mルール（③の apply_50m_rule）を当てる。"""
    if measurement_id is None or rule.badge_type_id is None or time_band.id is None:
        return SavedBadge(user_badge_id=None, replaced=None)  # DBにルールや時間帯が無い間は保存しない

    measurement = Measurement.objects.get(pk=measurement_id)
    badge_type = BadgeType.objects.get(pk=rule.badge_type_id)

    # 50mルールで「上書き」されたバッジを返すため、適用前に見えていたものを覚えておく
    visible_before = set(
        UserBadge.objects.filter(
            user=user,
            time_band_id=time_band.id,
            badge_type__category=badge_type.category,
            show_on_map=True,
        ).values_list("pk", flat=True)
    )

    user_badge = UserBadge.objects.create(
        user=user,
        badge_type=badge_type,
        time_band_id=time_band.id,
        measurement=measurement,
        acquired_at=measurement.measured_at,
    )
    apply_50m_rule(user_badge)

    replaced = None
    if user_badge.show_on_map and visible_before:
        hidden = list(
            UserBadge.objects.filter(pk__in=visible_before, show_on_map=False).select_related("badge_type")
        )
        if hidden:
            replaced = max(hidden, key=lambda b: b.badge_type.strength).badge_type.code
    return SavedBadge(user_badge_id=user_badge.id, replaced=replaced)
