import calendar
import math
from datetime import time
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

# ===== ヒートマップのマス目 =====
# 緯度経度を約100mのマスに区切る。②地図担当も同じ値で四角形を描く
#   南端 = cell_y * CELL_LAT_DEG / 西端 = cell_x * CELL_LNG_DEG
CELL_LAT_DEG = Decimal("0.0009")  # 緯度方向 約100m
CELL_LNG_DEG = Decimal("0.0011")  # 経度方向 日本付近で約100m


def to_cell(lat, lng):
    """緯度経度 → (cell_x, cell_y)"""
    lat = Decimal(str(lat))
    lng = Decimal(str(lng))
    return math.floor(lng / CELL_LNG_DEG), math.floor(lat / CELL_LAT_DEG)


# ===== ② 時間帯 =====
class TimeBand(models.Model):
    """昼・夜など。マップのセレクトボックスの選択肢になる"""

    name = models.CharField("名前", max_length=30)
    start_time = models.TimeField("開始時刻")
    end_time = models.TimeField("終了時刻")
    sort_order = models.PositiveIntegerField("表示順", default=0)
    is_active = models.BooleanField("有効", default=True)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = verbose_name_plural = "時間帯"

    def __str__(self):
        return self.name

    @property
    def wraps(self):
        """夜（22:00〜翌6:00）のように日付をまたぐか"""
        return self.start_time > self.end_time

    @property
    def code(self):
        """画面のバッジ部品（badge.js）が使う "d"（昼）/ "n"（夜）。日付をまたぐ時間帯を夜とみなす
        measure_store.get_time_band の code と同じ値になる（昼 6:00〜22:00 / 夜 22:00〜6:00）"""
        return "n" if self.wraps else "d"

    def contains(self, t):
        """時刻 t がこの時間帯に入るか。夜（22:00〜翌6:00）のような日またぎにも対応"""
        if self.start_time <= self.end_time:
            return self.start_time <= t < self.end_time
        return t >= self.start_time or t < self.end_time

    @classmethod
    def for_datetime(cls, dt):
        """日時から時間帯を判定する。どれにも入らなければ None"""
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt)
        t = timezone.localtime(dt).time()
        for band in cls.objects.filter(is_active=True):
            if band.contains(t):
                return band
        return None


# ===== ③ バッジの種類 =====
class BadgeType(models.Model):
    class Category(models.TextChoices):
        LOUD = "loud", "大きい音"
        SILENCE = "silence", "静寂"

    class Operator(models.TextChoices):
        GTE = "gte", "以上"
        LTE = "lte", "以下"

    name = models.CharField("名前", max_length=50)
    category = models.CharField("系統", max_length=20, choices=Category.choices)
    threshold_db = models.DecimalField("しきい値(dB)", max_digits=5, decimal_places=2)
    condition_operator = models.CharField("条件", max_length=3, choices=Operator.choices)
    required_duration_seconds = models.PositiveSmallIntegerField("必要な秒数")
    sort_order = models.PositiveIntegerField("表示順", default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = verbose_name_plural = "バッジの種類"

    def __str__(self):
        return self.name

    def is_satisfied(self, avg_db, duration_seconds):
        """平均dBと測定秒数が、このバッジの条件を満たすか"""
        avg_db = Decimal(str(avg_db))
        if duration_seconds < self.required_duration_seconds:
            return False
        if self.condition_operator == self.Operator.GTE:
            return avg_db >= self.threshold_db
        return avg_db <= self.threshold_db

    @property
    def strength(self):
        """50mルールで比べる強さ（同じ系統どうしで比べる。大きいほど強い）
        大きい音系：dBが高いほど強い / 静寂系：保てた秒数が長いほど強い"""
        if self.category == self.Category.LOUD:
            return (self.threshold_db, self.required_duration_seconds)
        return (self.required_duration_seconds, -self.threshold_db)

    @property
    def code(self):
        """画面のバッジ部品（components/badge.html・badge.js）のコード。b90 / b80 / b70 / q40 / q35
        ★静寂は秒数ではなくしきい値で分ける。測定の決まりでは静寂も深い静寂も15秒で、秒数では区別できない"""
        if self.category == self.Category.LOUD:
            return f"b{self.threshold_db:.0f}"
        return "q35" if self.threshold_db <= 35 else "q40"

    @classmethod
    def satisfied_by(cls, avg_db, duration_seconds):
        """条件を満たすバッジを全部返す（強い順）"""
        hits = [b for b in cls.objects.all() if b.is_satisfied(avg_db, duration_seconds)]
        return sorted(hits, key=lambda b: (b.category, b.strength), reverse=True)


# ===== ① 測定記録 =====
class Measurement(models.Model):
    """調査ボタンで測った結果。バッジが取れなかった測定も残す（ヒートマップ用）"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="measurements",
        verbose_name="ユーザー",
    )
    latitude = models.DecimalField("緯度", max_digits=10, decimal_places=7)
    longitude = models.DecimalField("経度", max_digits=10, decimal_places=7)
    gps_accuracy = models.DecimalField("GPS精度(m)", max_digits=8, decimal_places=2, null=True, blank=True)
    avg_db = models.DecimalField("平均dB", max_digits=5, decimal_places=2)
    max_db = models.DecimalField("最大dB", max_digits=5, decimal_places=2)
    duration_seconds = models.PositiveSmallIntegerField("測定秒数")
    time_band = models.ForeignKey(
        TimeBand,
        on_delete=models.PROTECT,  # 時間帯を消しても測定記録は消えない
        null=True,
        blank=True,
        related_name="measurements",
        verbose_name="時間帯",
    )
    measured_at = models.DateTimeField("測定日時")
    cell_x = models.IntegerField("マス目X", editable=False)
    cell_y = models.IntegerField("マス目Y", editable=False)
    created_at = models.DateTimeField("登録日時", auto_now_add=True)

    class Meta:
        ordering = ["-measured_at"]
        verbose_name = verbose_name_plural = "測定記録"
        indexes = [
            models.Index(fields=["measured_at"]),
            models.Index(fields=["cell_x", "cell_y"]),
        ]

    def __str__(self):
        return f"{self.measured_at:%Y-%m-%d %H:%M} {self.avg_db}dB"

    def save(self, *args, **kwargs):
        # JSONのfloatや文字列で来ても Decimal にそろえる（50mルールの計算で落ちないように）
        for name in ("latitude", "longitude", "gps_accuracy", "avg_db", "max_db"):
            value = getattr(self, name)
            if value is not None:
                setattr(self, name, self._meta.get_field(name).to_python(value))
        # マス目と時間帯は保存時に自動で決める
        self.cell_x, self.cell_y = to_cell(self.latitude, self.longitude)
        if self.time_band_id is None and self.measured_at:
            self.time_band = TimeBand.for_datetime(self.measured_at)
        super().save(*args, **kwargs)


# ===== ④ 獲得バッジ =====
class UserBadge(models.Model):
    """誰が、どのバッジを、いつ獲得したか。50mルールで非表示にしても消さない"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="badges",
        verbose_name="ユーザー",
    )
    badge_type = models.ForeignKey(
        BadgeType, on_delete=models.PROTECT, related_name="user_badges", verbose_name="バッジの種類"
    )
    time_band = models.ForeignKey(
        TimeBand, on_delete=models.PROTECT, related_name="user_badges", verbose_name="時間帯"
    )
    measurement = models.ForeignKey(
        Measurement, on_delete=models.CASCADE, related_name="badges", verbose_name="元の測定"
    )
    show_on_map = models.BooleanField("ローカルマップに表示", default=True)
    acquired_at = models.DateTimeField("獲得日時", default=timezone.now)

    class Meta:
        ordering = ["-acquired_at"]
        verbose_name = verbose_name_plural = "獲得バッジ"
        indexes = [
            models.Index(fields=["user", "time_band", "show_on_map"]),
        ]

    def __str__(self):
        return f"{self.user} - {self.badge_type}（{self.time_band}）"

    def save(self, *args, **kwargs):
        # 時間帯は元の測定と必ず同じにする
        if self.time_band_id is None and self.measurement_id:
            self.time_band_id = self.measurement.time_band_id
        super().save(*args, **kwargs)


# ===== ⑦ 投稿 =====
class Post(models.Model):
    """獲得バッジ1つにつき投稿は最大1件"""

    user_badge = models.OneToOneField(
        UserBadge, on_delete=models.CASCADE, related_name="post", verbose_name="獲得バッジ"
    )
    description = models.TextField("説明文", blank=True)
    photo = models.ImageField("写真", upload_to="posts/%Y/%m/", blank=True)  # EXIFは保存前に消す
    created_at = models.DateTimeField("投稿日時", auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = verbose_name_plural = "投稿"

    def __str__(self):
        return f"投稿 {self.id}（{self.user_badge}）"


# ===== ⑤ タグ =====
class Tag(models.Model):
    """共通タグ（いつでも出る）と季節タグ（毎年決まった期間だけ出る）"""

    class TagType(models.TextChoices):
        COMMON = "common", "共通"
        SEASONAL = "seasonal", "季節"

    name = models.CharField("名前", max_length=50)
    icon = models.CharField("アイコン", max_length=255, blank=True)
    tag_type = models.CharField("種別", max_length=20, choices=TagType.choices, default=TagType.COMMON)

    # 季節タグだけ使う（共通タグは空のまま）。毎年くり返す
    start_month = models.PositiveSmallIntegerField("開始月", null=True, blank=True)
    start_day = models.PositiveSmallIntegerField("開始日", null=True, blank=True)
    start_time = models.TimeField("開始時刻", null=True, blank=True)
    end_month = models.PositiveSmallIntegerField("終了月", null=True, blank=True)
    end_day = models.PositiveSmallIntegerField("終了日", null=True, blank=True)
    end_time = models.TimeField("終了時刻", null=True, blank=True)
    # 季節タグ図鑑に出す期間の言葉（例：祭りの時期／12月31日の夜）。空なら月日から自動で作る
    period_text = models.CharField(
        "期間の表示",
        max_length=30,
        blank=True,
        help_text="季節タグ図鑑に出す言葉。空なら開始・終了の月日から自動で作る（例：6月〜8月）",
    )

    is_active = models.BooleanField("有効", default=True)
    sort_order = models.PositiveIntegerField("表示順", default=0)

    # 測定記録 ⇔ タグ の多対多。measurement.tags.all() でタグ一覧が取れる
    measurements = models.ManyToManyField(
        Measurement, through="MeasurementTag", related_name="tags", blank=True
    )

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = verbose_name_plural = "タグ"

    def __str__(self):
        return self.name

    @property
    def period_label(self):
        """季節タグ図鑑に出す期間。「期間の表示」があればそれを使い、空なら月日から作る
        例：6月〜8月（月の初日〜末日）／ 1月1日〜3日（同じ月）／ 12月31日（1日だけ）／ 12月20日〜1月5日"""
        if self.period_text:
            return self.period_text
        if None in (self.start_month, self.start_day, self.end_month, self.end_day):
            return ""
        sm, sd, em, ed = self.start_month, self.start_day, self.end_month, self.end_day
        # 2月29日も末日とみなせるよう、うるう年（2024年）で数える
        if sd == 1 and ed == calendar.monthrange(2024, em)[1]:
            return f"{sm}月" if sm == em else f"{sm}月〜{em}月"
        if (sm, sd) == (em, ed):
            return f"{sm}月{sd}日"
        if sm == em:
            return f"{sm}月{sd}日〜{ed}日"
        return f"{sm}月{sd}日〜{em}月{ed}日"

    def is_available(self, dt=None):
        """いま（または dt の日時に）選択肢に出してよいか"""
        if not self.is_active:
            return False
        if self.tag_type == self.TagType.COMMON:
            return True
        if None in (self.start_month, self.start_day, self.end_month, self.end_day):
            return False  # 期間が未設定の季節タグは出さない

        dt = timezone.localtime(dt or timezone.now())
        # (月, 日, 時刻) のタプルで比べる。時刻が空なら開始は0:00、終了は23:59:59扱い
        now = (dt.month, dt.day, dt.time())
        start = (self.start_month, self.start_day, self.start_time or time.min)
        end = (self.end_month, self.end_day, self.end_time or time.max)

        if start <= end:  # ふつうの期間（例：6/1〜8/31）
            return start <= now <= end
        return now >= start or now <= end  # 年またぎ（例：12/31 22:00〜1/3）

    @classmethod
    def available(cls, dt=None):
        """投稿ポップアップに出すタグ一覧"""
        return [t for t in cls.objects.filter(is_active=True) if t.is_available(dt)]


# ===== ⑥ 測定記録とタグの中間テーブル =====
class MeasurementTag(models.Model):
    measurement = models.ForeignKey(Measurement, on_delete=models.CASCADE, verbose_name="測定記録")
    tag = models.ForeignKey(Tag, on_delete=models.PROTECT, verbose_name="タグ")
    created_at = models.DateTimeField("付けた日時", auto_now_add=True)

    class Meta:
        verbose_name = verbose_name_plural = "測定のタグ"
        constraints = [
            models.UniqueConstraint(fields=["measurement", "tag"], name="unique_measurement_tag"),
        ]

    def __str__(self):
        return f"{self.measurement_id} - {self.tag}"
