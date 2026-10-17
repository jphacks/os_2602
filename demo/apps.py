# =============================================================================
# apps.py = このアプリ(売り場)の名札
#
#   ★中身はほぼ触りません。名前を書いてあるだけです。
# =============================================================================

from django.apps import AppConfig


class DemoConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "demo"
    verbose_name = "デモ(開発モード限定)"
