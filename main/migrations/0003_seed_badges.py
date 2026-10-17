# バッジの種類（5つ）と時間帯（昼・夜）の初期データを入れる。
#
# ★これが無いと、測定APIはバッジを判定しても保存しない（measure_store.save_badge）。
# ★名前が同じものが管理画面で登録済みなら、そちらを残して何もしない（二重に作らない）。
# ★値は企画書と測定の決まり（docs/API_measurement.md）に合わせている。
#   大きい音：10秒のLeqが しきい値以上 / 静寂：15秒のLeqが しきい値以下
#   画面のコード（b90 など）は BadgeType.code がしきい値から作る。

from datetime import time
from decimal import Decimal

from django.db import migrations

# (名前, 開始時刻, 終了時刻, 表示順)。夜は日をまたぐ（TimeBand.contains が扱う）
TIME_BANDS = [
    ("昼", time(6, 0), time(22, 0), 1),
    ("夜", time(22, 0), time(6, 0), 2),
]

# (名前, 系統, しきい値, 条件, 必要な秒数, 表示順)。並びは badge.js の CODES と同じ
BADGE_TYPES = [
    ("90dBバッジ", "loud", Decimal("90"), "gte", 10, 1),
    ("80dBバッジ", "loud", Decimal("80"), "gte", 10, 2),
    ("70dBバッジ", "loud", Decimal("70"), "gte", 10, 3),
    ("静寂バッジ", "silence", Decimal("40"), "lte", 15, 4),
    ("深い静寂バッジ", "silence", Decimal("35"), "lte", 15, 5),
]


def seed(apps, schema_editor):
    TimeBand = apps.get_model("main", "TimeBand")
    BadgeType = apps.get_model("main", "BadgeType")

    for name, start, end, order in TIME_BANDS:
        TimeBand.objects.get_or_create(
            name=name,
            defaults={"start_time": start, "end_time": end, "sort_order": order},
        )

    for name, category, threshold, operator, seconds, order in BADGE_TYPES:
        BadgeType.objects.get_or_create(
            name=name,
            defaults={
                "category": category,
                "threshold_db": threshold,
                "condition_operator": operator,
                "required_duration_seconds": seconds,
                "sort_order": order,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0002_tag_period_text"),
    ]

    operations = [
        # 戻すときは何もしない（獲得バッジが参照しているので消せない。消すなら管理画面から）
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
