# =============================================================================
# apps.py = このアプリ(売り場)の名札
#
#   python manage.py startapp で自動的に作られるファイル。
#   ★中身はほぼ触りません。名前と、migrate の後にタグを入れる設定だけです。
# =============================================================================

from django.apps import AppConfig
from django.db.models.signals import post_migrate


class MainConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "main"
    verbose_name = "画面とAPI"

    def ready(self):
        # migrate の後に、共有のタグ（main/tag_data.py）のうちDBに無いものを入れる
        from main.tag_data import sync_tags

        post_migrate.connect(sync_tags, sender=self)
