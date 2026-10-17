# マス目を約100m（0.0009度 × 0.0011度）から約10m（標準地域メッシュの100mメッシュを10等分）に変えたので、
# 保存済みの測定記録の cell_x / cell_y を計算し直す。
#
# ★式は main/models.py の to_cell と同じ。マイグレーションは後からモデルが変わっても
#   同じ結果になるように、値をここに書き写している（models.py を import しない）。

import math
from decimal import Decimal

from django.db import migrations

CELLS_PER_DEG_LAT = 12000  # 緯度 0.3秒
CELLS_PER_DEG_LNG = 8000  # 経度 0.45秒


def recompute_cells(apps, schema_editor):
    Measurement = apps.get_model("main", "Measurement")
    changed = []
    for m in Measurement.objects.only("id", "latitude", "longitude", "cell_x", "cell_y").iterator():
        m.cell_x = math.floor(Decimal(str(m.longitude)) * CELLS_PER_DEG_LNG)
        m.cell_y = math.floor(Decimal(str(m.latitude)) * CELLS_PER_DEG_LAT)
        changed.append(m)
    Measurement.objects.bulk_update(changed, ["cell_x", "cell_y"], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0003_seed_badges"),
    ]

    operations = [
        # 戻すときは何もしない（古い100mのマスが必要になったら計算し直す）
        migrations.RunPython(recompute_cells, migrations.RunPython.noop),
    ]
