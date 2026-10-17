from django.contrib import admin

from .models import BadgeType, Measurement, MeasurementTag, Post, Tag, TimeBand, UserBadge


@admin.register(TimeBand)
class TimeBandAdmin(admin.ModelAdmin):
    list_display = ["name", "start_time", "end_time", "sort_order", "is_active"]
    list_editable = ["sort_order", "is_active"]


@admin.register(BadgeType)
class BadgeTypeAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "condition_operator", "threshold_db", "required_duration_seconds", "sort_order"]
    list_editable = ["threshold_db", "required_duration_seconds", "sort_order"]  # デモ中にしきい値を調整できる


@admin.register(Measurement)
class MeasurementAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "avg_db", "max_db", "duration_seconds", "time_band", "measured_at", "cell_x", "cell_y"]
    list_filter = ["time_band"]
    date_hierarchy = "measured_at"


@admin.register(UserBadge)
class UserBadgeAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "badge_type", "time_band", "show_on_map", "acquired_at"]
    list_filter = ["badge_type", "time_band", "show_on_map"]


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ["id", "user_badge", "measurement", "created_at"]


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ["name", "tag_type", "start_month", "start_day", "end_month", "end_day", "is_active", "sort_order"]
    list_filter = ["tag_type", "is_active"]
    list_editable = ["is_active", "sort_order"]
    fieldsets = [
        (None, {"fields": ["name", "icon", "tag_type", "is_active", "sort_order"]}),
        ("音の図鑑（マイページ）", {"fields": ["medal_color", "hint", "description", "is_rare"]}),
        ("季節タグの期間（毎年くり返す。共通タグは空のまま）", {
            "fields": [
                ("start_month", "start_day", "start_time"),
                ("end_month", "end_day", "end_time"),
                "period_text",
            ],
        }),
    ]


@admin.register(MeasurementTag)
class MeasurementTagAdmin(admin.ModelAdmin):
    list_display = ["measurement", "tag", "created_at"]
    list_filter = ["tag"]
