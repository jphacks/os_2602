# 地図のバッジAPIが緯度・経度の範囲で測定記録を探すので、索引を足す

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("main", "0005_measurement_spectrum"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="measurement",
            index=models.Index(fields=["latitude", "longitude"], name="main_measur_lat_lng_idx"),
        ),
    ]
