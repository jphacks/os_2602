# 測定API（docs/API.md に追記する分）

担当：① 受け取り口・判定 ／ ③ 保存（`main/measure_store.py`）。変えるときは全員に共有する。

## 調査の流れ（measure.js）

「今の音量」＝直近1秒のLeq。100msごとに画面へ流す（いつでもリアルタイムで表示できる）。

```text
通常の測定 ── 10秒ごとに記録を送る（ヒートマップの材料。バッジにはならない）
  判定開始の合図は100msごとの値（一瞬でも超えたら始める）
  ├ 70dB以上 → 大きい音の判定（10秒）
  └ 40dB未満 → 静寂の判定（15秒）
               ※この調査で静寂バッジを取った後は、35dB未満で深い静寂の判定（15秒）

判定中 ── 判定を始めた時点からの区間を測る
  取り消しは「判定を始めてからの直近1秒のLeq」で決める
  ├ 大きい音：70未満が2秒続いた（拍手の切れ目など一瞬の途切れでは取り消さない）
  ├ 静寂：40を超えた／深い静寂：35を超えた（すぐ取り消す。区間のLeqがどうせ届かないため）
  │   → 判定を取り消し。測った分は通常の記録として送り（5秒未満なら送らない）、通常の測定に戻る
  └ 時間いっぱい続いた → 区間を judge 付きで送り、サーバーが判定 → 通常の測定に戻る
```

- 新しいバッジ（この調査でまだ取っていない、または同じ系統でより強い）が出たら一時停止し、マイクも止める。ポップアップを閉じたら `resume()` で再開
- 送信は待たずに測り続ける（送っている間も画面の数字は動く）
- 画面ロック・アプリ切替では測りかけの区間を捨てて中断。戻ったら再開ボタンで続ける
- 終える（`stop()`）と測りかけの区間は捨てる

## POST /api/measurements

区間が1つ終わるたびに1回送る。

### 送るもの

```json
{
  "avg_db": 83.1,
  "max_db": 90.2,
  "duration_seconds": 10.0,
  "judge": "loud",
  "latitude": 35.681236,
  "longitude": 139.767125,
  "gps_accuracy": 12.5,
  "measured_at": "2026-10-17T11:02:33+09:00"
}
```

| 項目 | 内容 | 範囲 |
| --- | --- | --- |
| avg_db | 区間の平均。等価騒音レベル（Leq）＝エネルギーで平均してdBに戻した値 | 0〜140 |
| max_db | 区間の最大（100msごとの値の最大） | 0〜150、avg_db 以上 |
| duration_seconds | 区間の長さ。通常10、大きい音の判定10、静寂・深い静寂の判定15、取り消し後は短いこともある | 1〜65 |
| judge | `"loud"` / `"quiet"` = 判定が最後まで続いた区間。`null` = 通常の記録（取り消した区間も含む） | |
| latitude / longitude | 測り終えた時点の位置 | |
| gps_accuracy | 位置の誤差（m）。500mより悪いと受け付けない | |
| measured_at | 測り終えた時刻（端末の時計）。10分以上ずれていたらサーバーの時刻を使う | |

`judge` は保存しなくてよい（判定に使うだけ）。

### 返すもの（201）

```json
{
  "measurement": {
    "id": 128,
    "avg_db": 83.1,
    "max_db": 90.2,
    "duration_seconds": 10.0,
    "time_band": { "id": 1, "name": "昼", "code": "d" }
  },
  "badge": {
    "code": "b80",
    "name": "80dBバッジ",
    "user_badge_id": 42,
    "replaced": "b70"
  },
  "saved": true
}
```

- `badge` はバッジが出なければ `null`
- `badge.code` は `b90` / `b80` / `b70` / `q40` / `q35`（バッジ部品のコードと同じ）
- `badge.replaced` は50mルールで地図から外れた自分のバッジのコード。無ければ `null`（獲得ポップアップの「この場所の70dBバッジを上書きしました」に使う）
- `time_band` はDBに合わせて `TimeBand.id` で表す（地図の `time_band` も同じ id）。`name` は表示用。`code` は `TimeBand.code` の `d`（昼）/ `n`（夜）で、レアの判定（badge.js）に使う
- 見えないアカウントをこのリクエストで作ったときだけ `csrf_token` が付く（measure.js が次の送信に使う）
- `badge.code` は `BadgeType.code`（b90 / b80 / b70 / q40 / q35）
- 管理画面に TimeBand / BadgeType がまだ無い間は、企画書の値で判定だけして返す（`badge.user_badge_id` は `null`。測った時刻がどの時間帯にも入らないと `time_band.id` も `null` になり、バッジは保存されない）

### エラー

`{"error": "画面にそのまま出せる文言"}` の形（テンプレートの決まりどおり）。

| ステータス | いつ |
| --- | --- |
| 400 | 値が足りない・範囲外・組み合わせがおかしい・位置の精度が悪い |
| 403 | CSRFトークンがない・古い |
| 429 | 同じユーザーが1分に20回より多く送った |

## バッジ判定のルール（強い順に上から見て、最初に当てはまったもの）

`judge` が付いた区間だけを判定する。通常の記録はバッジにならない。

1. `judge="quiet"`、15秒以上、`avg_db` が35dB以下 → `q35`（深い静寂）
2. `judge="quiet"`、15秒以上、`avg_db` が40dB以下 → `q40`（静寂）
3. `judge="loud"`、10秒以上、`avg_db` が 90 / 80 / 70 以上 → `b90` / `b80` / `b70`
4. どれでもなければバッジなし

区間の長さは0.2秒の不足まで許す。しきい値と秒数は `measure_store.get_badge_rules()`（③が BadgeType から読むように置き換える）。

## 画面に渡すイベント（measure.js → ④）

| イベント | e.detail | いつ |
| --- | --- | --- |
| state | `{ state }` idle / starting / measuring / paused / interrupted / stopped | 状態が変わったとき |
| level | `{ db, level, mode, elapsed, target, segmentLeq, guide }` | 100msごと |
| judge-start | `{ mode, target }` | 判定を始めた |
| judge-cancel | `{ mode, elapsed }` | 音量が通常に戻ったので判定を取り消した |
| warning | `{ db }` | 85dB以上が続いている（10秒に1回まで） |
| round | `{ result }` | 区間が終わって送る |
| recorded | `{ result, response, badge, already, timeBand }` | 記録した（新しいバッジではない） |
| badge | `{ result, response, badge, name, replaced, timeBand }` | 新しいバッジ。一時停止中 |
| error | `{ code, message }` | エラー。message はそのまま画面に出せる |

`level` の中身

- `db` … いまの値（100ms）。`level` … 今の音量（直近1秒のLeq）。大きく表示するならこちら
- `mode` … `"normal"` / `"loud"` / `"quiet"` / `"deep"`
- `elapsed` / `target` … いまの区間の経過秒数 / 長さ（通常10、大きい音10、静寂15、深い静寂15）。判定中の進み具合のバーに使える
- `segmentLeq` … いまの区間のLeq
- `guide` … true のとき「音の発生源に近づいてみよう（安全な場所から）」を出す
