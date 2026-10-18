# =============================================================================
# api_measure.py = 測定の受け取り口と、結果の処理（①の担当）
#
# ▼ 役割の分け方
#
#   ここ（api_measure.py） … 送られてきた値の確認、送りすぎの制限、バッジ判定、返事の組み立て
#   measure_store.py       … DBに触る処理（保存・時間帯・ルールの読み込み・50mルール）
#                            モデルと50mルールの中身は③の main/models.py・main/badges.py
#
# ▼ なぜ api.py ではなく別ファイルか
#
#   main/api.py は③も編集するので、同じファイルを2人で触ると衝突しやすい。
#
# ▼ 送受信の形は docs/API_measurement.md を正とする
# =============================================================================

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from django.contrib.auth import get_user_model, login
from django.core.cache import cache
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from main import measure_store as store
from main.api import json_response, read_json
from main.middleware import random_username

# --- 調整する数値はここだけ -------------------------------------------------
RATE_LIMIT_PER_MINUTE = 20  # 通常は10秒ごと。判定の開始・取り消しで区間が短くなると増える（最短5秒）
MAX_GPS_ACCURACY_M = 500  # これより精度が悪い位置は地図を乱すので受け付けない
MAX_CLOCK_SKEW = timedelta(minutes=10)  # 端末の時計がこれ以上ずれていたらサーバーの時刻を使う
JUDGES = ("loud", "quiet")  # 判定してほしい区間の種類（null は通常の記録）
JUDGE_EPS = 0.2  # 区間の長さの、ほんの少しの足りなさは許す（100msごとに測るため）
SPECTRUM_BANDS = 16  # 音の形の帯の数（measure.js の spectrumBands と同じ）


@dataclass(frozen=True)
class MeasurementInput:
    """確認済みの測定1回分。measure_store にはこの形で渡す。"""

    avg_db: float  # 区間の平均（等価騒音レベル Leq）
    max_db: float
    duration_seconds: float  # 区間の長さ。通常10、大きい音の判定10、静寂・深い静寂の判定15、取り消し後は短いこともある
    judge: str | None  # "loud" / "quiet" = 判定してほしい区間。None = 通常の記録。保存はしなくてよい
    latitude: float
    longitude: float
    gps_accuracy: float  # メートル
    measured_at: datetime  # タイムゾーン付き
    spectrum: list[float] | None = None  # 音の形（0〜1 が16個）。無い・壊れているときは None
    indoor: bool = False  # 屋内で測ったか（調査画面の「屋外／屋内」）


# --- 受け取り口 ---------------------------------------------------------------


@require_http_methods(["POST"])
def create_measurement(request):
    """測定1回分を受け取る。バッジが出たかどうかを返す。"""
    data, error = read_json(request)
    if error:
        return error
    if not isinstance(data, dict):
        return json_response({"error": "送信内容の形式が正しくありません。"}, status=400)

    m, message = parse_measurement(data)
    if message:
        return json_response({"error": message}, status=400)

    new_user = False
    if not request.user.is_authenticated:
        # ★本来は③の InvisibleAccountMiddleware がページを開いた時点で作る。
        #   settings.py に登録される前や、ページを開かずにAPIだけ叩いた場合の保険
        #   （ミドルウェアの登録後は、ここを401にしてもよい）
        _create_anonymous_user(request)
        new_user = True

    if _rate_limited(request.user.pk):
        return json_response({"error": "測定の回数が多すぎます。少し待ってから、もう一度試してください。"}, status=429)

    result = handle_measurement(request.user, m)

    if new_user:
        # ログインするとDjangoが整理券（CSRFトークン）を作り直すので、新しい方を返す。
        # measure.js はこれを覚えて次の送信に使う。
        result["csrf_token"] = get_token(request)
    return json_response(result, status=201)


# --- 値の確認 -----------------------------------------------------------------


def parse_measurement(data: dict) -> tuple[MeasurementInput | None, str | None]:
    """送られてきた値を確認して MeasurementInput にする。

    (中身, None) か (None, エラーの文言) のどちらかが返る。
    ★ログインのない匿名アプリなので、値は改ざんされうる前提で範囲を確認する。
    """
    try:
        avg_db = _number(data, "avg_db", 0, 140)
        max_db = _number(data, "max_db", 0, 150)
        duration = _number(data, "duration_seconds", 1, 65)
        lat = _number(data, "latitude", -90, 90)
        lng = _number(data, "longitude", -180, 180)
        accuracy = _number(data, "gps_accuracy", 0, 100000)
    except ValueError as e:
        return None, str(e)

    judge = data.get("judge")
    if judge is not None and judge not in JUDGES:
        return None, "judge の値が正しくありません。"
    if max_db + 0.5 < avg_db:
        return None, "測定値の組み合わせが正しくありません。"
    if accuracy > MAX_GPS_ACCURACY_M:
        return None, "位置情報の精度が低いため記録できませんでした。屋外や窓の近くで、もう一度試してください。"

    return MeasurementInput(
        avg_db=round(avg_db, 1),
        max_db=round(max_db, 1),
        duration_seconds=round(duration, 1),
        judge=judge,
        latitude=lat,
        longitude=lng,
        gps_accuracy=round(accuracy, 1),
        measured_at=_parse_time(data.get("measured_at")),
        spectrum=_parse_spectrum(data.get("spectrum")),
        indoor=data.get("indoor") is True,  # 送られていない・true 以外なら屋外
    ), None


def _parse_spectrum(value) -> list[float] | None:
    """音の形。模様に使うだけなので、形が正しくなければ断らずに捨てる（測定は記録する）"""
    if not isinstance(value, list) or len(value) != SPECTRUM_BANDS:
        return None
    out = []
    for v in value:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not (0 <= v <= 1):
            return None
        out.append(round(float(v), 2))
    return out


def _number(data: dict, key: str, lo: float, hi: float, default: float | None = None) -> float:
    value = data.get(key, default)
    if value is None:
        raise ValueError(f"{key} がありません。")
    if isinstance(value, bool):  # True/False は数として受け付けない
        raise ValueError(f"{key} は数で送ってください。")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} は数で送ってください。") from None
    if number != number or not (lo <= number <= hi):  # number != number は NaN の判定
        raise ValueError(f"{key} の値が範囲外です。")
    return number


def _parse_time(value) -> datetime:
    """端末の時刻を使う。無い・壊れている・大きくずれている場合はサーバーの時刻。"""
    now = timezone.now()
    if not isinstance(value, str):
        return now
    parsed = parse_datetime(value)
    if parsed is None:
        return now
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    if abs(parsed - now) > MAX_CLOCK_SKEW:
        return now
    return parsed


# --- 送りすぎの制限 -------------------------------------------------------------


def _rate_limited(user_id: int) -> bool:
    """同じユーザーの測定を1分にRATE_LIMIT_PER_MINUTE回までにする。

    ★Djangoのキャッシュ（設定がなければメモリ）で数える。gunicornのプロセスごとに
      数えるので厳密ではないが、いたずらの大量送信を止めるには十分。
    """
    key = f"measure-rate:{user_id}:{int(timezone.now().timestamp() // 60)}"
    if cache.add(key, 1, timeout=70):
        return False
    try:
        count = cache.incr(key)
    except ValueError:  # 期限切れと同時に来た
        cache.set(key, 1, timeout=70)
        return False
    return count > RATE_LIMIT_PER_MINUTE


# --- 見えないアカウント（ミドルウェアが無いときの保険） ------------------------------


def _create_anonymous_user(request):
    User = get_user_model()
    user = User(username=random_username())  # ③と同じ形の名前（例：静かなフクロウ-3f9a2c）
    user.set_unusable_password()  # パスワードではログインできないようにする
    user.save()
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return user


# --- 結果の処理 -----------------------------------------------------------------


def handle_measurement(user, m: MeasurementInput) -> dict:
    """保存して、バッジを判定して、measure.js と獲得ポップアップが読む形の辞書を返す。

    DBに触る部分はすべて measure_store に任せる。
    """
    with transaction.atomic():
        band = store.get_time_band(m.measured_at)
        measurement_id = store.save_measurement(user, m, band)
        rule = judge_badge(m, store.get_badge_rules())
        saved_badge = store.save_badge(user, measurement_id, rule, band, m) if rule else None

    return {
        "measurement": {
            "id": measurement_id,
            "avg_db": m.avg_db,
            "max_db": m.max_db,
            "duration_seconds": m.duration_seconds,
            "time_band": {"id": band.id, "name": band.name, "code": band.code},
        },
        "badge": (
            {
                "code": rule.code,
                "name": rule.name,
                "user_badge_id": saved_badge.user_badge_id,
                "replaced": saved_badge.replaced,
            }
            if rule
            else None
        ),
        "saved": measurement_id is not None,
    }


def judge_badge(m: MeasurementInput, rules: list[store.BadgeRule]) -> store.BadgeRule | None:
    """強い順に並んだルールを上から見て、最初に当てはまったバッジを返す。

    判定するのは、measure.js が「判定してほしい」と送ってきた区間（judge）だけ。
    通常の記録（judge が None）はバッジにならない。どちらの系統も区間のLeqで判定する。
      大きい音系 … judge="loud"  で、rule.seconds 秒以上続き、Leqが threshold_db 以上
      静寂系     … judge="quiet" で、rule.seconds 秒以上続き、Leqが threshold_db 以下
    """
    if m.judge is None:
        return None
    for rule in rules:
        if rule.series != m.judge or m.duration_seconds < rule.seconds - JUDGE_EPS:
            continue
        if rule.at_least and m.avg_db >= rule.threshold_db:
            return rule
        if not rule.at_least and m.avg_db <= rule.threshold_db:
            return rule
    return None


def measurement_to_dict(m: MeasurementInput) -> dict:
    """ログや管理画面で中身を見るとき用。"""
    d = asdict(m)
    d["measured_at"] = m.measured_at.isoformat()
    return d
