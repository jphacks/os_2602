# 測定記録に「音の形」（バッジの音の標本の模様の材料）を足す。保存済みの記録は空のまま

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("main", "0004_cell_10m"),
    ]

    operations = [
        migrations.AddField(
            model_name="measurement",
            name="spectrum",
            field=models.JSONField(blank=True, null=True, verbose_name="音の形"),
        ),
    ]
