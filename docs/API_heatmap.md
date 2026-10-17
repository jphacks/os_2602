# ヒートマップAPI（docs/API.md に追記する分）

地図に見えている範囲の測定記録を、マスごとにまとめて返す。マスの平均dBで色を塗り、代表タグのアイコンを重ねる（企画書）。
中身は `main/api_heatmap.py`、マスの決まりは `main/models.py`（`CELLS_PER_DEG_LAT` / `CELLS_PER_DEG_LNG` / `CELL_LEVELS`）。

## マス目の決まり

国の標準地域メッシュ（JIS X 0410）に合わせている。保存するのは一番細かい10mのマスの番号（`Measurement.cell_x` / `cell_y`）だけで、粗いマスは番号を割って作る。

| 地図の拡大率（zoom） | `level` | マスの大きさ | 番号 |
| --- | --- | --- | --- |
| 18 以上 | `10m` | 緯度0.3秒 × 経度0.45秒（約9m × 11m） | `cell_x`, `cell_y` |
| 15〜17 | `100m` | 標準の100mメッシュ（約92m × 113m） | `cell_x // 10` |
| 14 以下（省略時は `100m`） | `1km` | 標準の3次メッシュ（約0.9km × 1.1km） | `cell_x // 100` |

- 10mのマスの番号：`cell_x = floor(経度 × 8000)`、`cell_y = floor(緯度 × 12000)`
- 粗いマスの境界は、標準メッシュの境界とぴったり一致する

## GET /api/heatmap

```text
/api/heatmap?south=34.64&west=135.58&north=34.66&east=135.60&zoom=17&time_band=1
```

| パラメーター | 内容 |
| --- | --- |
| south / west / north / east | 見えている範囲（`map.getBounds()` の南西・北東） |
| zoom | 地図の拡大率（`map.getZoom()`）。これでマスの段階が決まる。省略可 |
| time_band | 時間帯の `TimeBand.id`（セレクトボックスの値）。省略すると全部の時間帯 |
| mine | `1` なら自分の測定だけ（ローカルマップ）。省略すると全員分（全国マップ） |

### 返すもの（200）

```json
{
  "level": "100m",
  "cell_deg": { "lat": 0.000833333, "lng": 0.00125 },
  "cells": [
    {
      "x": 108475, "y": 41570,
      "south": 34.6416667, "west": 135.59375, "north": 34.6425, "east": 135.595,
      "avg_db": 71.4,
      "count": 12,
      "tag": { "id": 1, "name": "電車", "icon": "🚃" }
    }
  ],
  "truncated": false
}
```

- `x` / `y` はその段階でのマスの番号（`100m` なら10mの番号を10で割ったもの）
- `south` / `west` / `north` / `east` はマスの四隅。そのまま `new google.maps.Rectangle({ bounds: {south, west, north, east}, ... })` に渡せる
- `avg_db` はマスの中の測定記録の `avg_db` の平均（企画書の `Avg("avg_db")`）
- `tag` はそのマスで一番多く付けられたタグ（代表タグ）。タグが無ければ `null`
- `truncated` が `true` のときは、マスが多すぎて3000個で打ち切った（拡大すると全部出る）

### エラー（400）

`{"error": "画面にそのまま出せる文言"}`。範囲・拡大率・時間帯の値がおかしいとき。

## 調整できる値（`main/api_heatmap.py` の先頭）

- `MAX_CELLS` … 1回に返すマスの上限（3000）
- `FINE_MIN_USERS` … 10mのマスを出すのに必要な人数（今は 1 = 制限なし）。10mのマスは居場所がほぼ分かるので、企画書の「自宅を特定させない」に合わせるなら 3 などにする
