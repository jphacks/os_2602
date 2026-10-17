# =============================================================================
# measure_store.py = 測定まわりでDBに触る処理（③が書き換える場所）
#
# ▼ このファイルの約束
#
#   api_measure.py（①）はDBに直接触らず、ここの関数だけを呼ぶ。
#   ③のモデルがマージされたら、このファイルの「中身」だけを書き換える。
#   関数名・引数・戻り値の形は変えない（変えるときは①に一言）。
#
#   今は「DBなしでも動く仮の中身」が入っている:
#     ・時間帯とバッジのルールは、企画書の値を直書きして返す
#     ・保存は何もせず、id は None を返す（api_measure.py が "saved": false で返す）
#
# ▼ 書き換えるときのメモ（③向け）
#
#   ・api_measure.handle_measurement() が transaction.atomic() の中でこれらを呼ぶので、
#     途中で失敗すれば測定とバッジはまとめて取り消される
#   ・TimeBand は日をまたぐ（夜 22:00〜6:00 は start > end）。
#     start <= end なら start <= t < end、そうでなければ t >= start or t < end
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from django.utils import timezone

if TYPE_CHECKING:
    from main.api_measure import MeasurementInput


@dataclass(frozen=True)
class TimeBandInfo:
    id: int | None  # TimeBand.id（DBが無い間は None）
    name: str  # "昼" / "夜"
    code: str  # "d" / "n"（画面がレアの判定に使う）


@dataclass(frozen=True)
class BadgeRule:
    """バッジ1種類の判定ルール（BadgeType 1行ぶん）。"""

    code: str  # b90 / b80 / b70 / q40 / q35
    name: str
    series: str  # "loud"（Leqが threshold_db 以上）/ "quiet"（Leqが threshold_db 以下）
    threshold_db: float
    seconds: float  # 必要な継続秒数（判定の区間がこれ以上続いたこと）


@dataclass(frozen=True)
class SavedBadge:
    user_badge_id: int | None  # 保存した UserBadge.id
    replaced: str | None  # 50mルールで地図から外れた自分のバッジのコード（例 "b70"）。無ければ None


# 企画書の値。BadgeType が入るまではこれを使う。★強い順に並べる（上から順に判定する）
DEFAULT_RULES = [
    BadgeRule("q35", "深い静寂バッジ", "quiet", 35.0, 15.0),
    BadgeRule("q40", "静寂バッジ", "quiet", 40.0, 15.0),
    BadgeRule("b90", "90dBバッジ", "loud", 90.0, 10.0),
    BadgeRule("b80", "80dBバッジ", "loud", 80.0, 10.0),
    BadgeRule("b70", "70dBバッジ", "loud", 70.0, 10.0),
]


def get_time_band(measured_at: datetime) -> TimeBandInfo:
    """測った時刻の時間帯。

    ★③：TimeBand から引く。今は昼 6:00〜22:00 / 夜 22:00〜6:00 の直書き。
    """
    hour = timezone.localtime(measured_at).hour
    if 6 <= hour < 22:
        return TimeBandInfo(id=None, name="昼", code="d")
    return TimeBandInfo(id=None, name="夜", code="n")


def get_badge_rules() -> list[BadgeRule]:
    """バッジの判定ルール（強い順）。

    ★③：BadgeType から引いて BadgeRule にする。並びは強い順（静寂系 → 大きい音系の順でよい）。
    """
    return DEFAULT_RULES


def save_measurement(user, m: MeasurementInput, time_band: TimeBandInfo) -> int | None:
    """測定記録を保存して id を返す。バッジにならなかった回も保存する（ヒートマップの材料）。

    ★③：Measurement を作る。マス目番号（cell_x, cell_y）もここで計算する。
         judge は保存しなくてよい。
    """
    return None


def save_badge(
    user,
    measurement_id: int | None,
    rule: BadgeRule,
    time_band: TimeBandInfo,
    m: MeasurementInput,
) -> SavedBadge:
    """獲得バッジを保存し、50mルールを当てる。

    ★③：UserBadge を作り、同じ系統・同じ時間帯で半径50m以内の自分のバッジと比べて
         弱いほうの「マップに表示するか」を False にする。新しいほうが弱ければ新しいほうを False。
         古いほうを外したときは、そのコードを replaced に入れて返す。
    """
    return SavedBadge(user_badge_id=None, replaced=None)
