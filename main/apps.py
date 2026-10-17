# =============================================================================
# apps.py = このアプリ(売り場)の名札
#
#   python manage.py startapp で自動的に作られるファイル。
#   ★中身はほぼ触りません。名前を書いてあるだけです。
# =============================================================================

from django.apps import AppConfig


class MainConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "main"
    verbose_name = "画面とAPI"
