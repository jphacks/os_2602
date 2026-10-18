# 深い静寂バッジのしきい値を 35dB から 33.5dB に下げる。
#
# ★0003_seed_badges で入れた値（35）のままのときだけ書き換える。
#   管理画面で別の値に直してあれば、そちらを残す。
# ★画面のコード（q35）は BadgeType.code が「35以下なら q35」で決めるので、33.5 でも q35 のまま。
#   measure.js の deepDb と measure_store.py の DEFAULT_RULES も同じ値にしてある。

from decimal import Decimal

from django.db import migrations

NAME = "深い静寂バッジ"


def lower(apps, schema_editor):
    BadgeType = apps.get_model("main", "BadgeType")
    BadgeType.objects.filter(name=NAME, threshold_db=Decimal("35")).update(threshold_db=Decimal("33.5"))


def restore(apps, schema_editor):
    BadgeType = apps.get_model("main", "BadgeType")
    BadgeType.objects.filter(name=NAME, threshold_db=Decimal("33.5")).update(threshold_db=Decimal("35"))


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0009_measurement_is_indoor"),
    ]

    operations = [
        migrations.RunPython(lower, restore),
    ]
