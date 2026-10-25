# 昼と夜の境目を 22:00 から 18:00 に早める（昼 6:00〜18:00 / 夜 18:00〜翌6:00）。
#
# ★0003_seed_badges で入れた値（22:00）のままのときだけ書き換える。
#   管理画面で別の時刻に直してあれば、そちらを残す。
# ★すでに保存した測定・獲得バッジの時間帯はそのまま（測った時点の決まりで記録したもの）。
#   measure.js の localResponse と measure_store.py の get_time_band も同じ時刻にしてある。

from datetime import time

from django.db import migrations

OLD = time(22, 0)
NEW = time(18, 0)


def move(apps, schema_editor, old, new):
    TimeBand = apps.get_model("main", "TimeBand")
    TimeBand.objects.filter(name="昼", end_time=old).update(end_time=new)
    TimeBand.objects.filter(name="夜", start_time=old).update(start_time=new)


def earlier(apps, schema_editor):
    move(apps, schema_editor, OLD, NEW)


def restore(apps, schema_editor):
    move(apps, schema_editor, NEW, OLD)


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0010_deep_silence_33_5"),
    ]

    operations = [
        migrations.RunPython(earlier, restore),
    ]
