# =============================================================================
# admin.py = 管理画面に何を表示するかの設定
#
# ★ここに数行書くだけで、データを一覧・検索・追加・編集・削除できる画面が
#   完成する。自分で管理用の画面を作らなくてよい(Djangoの最大の武器)。
#
#   管理者アカウントの作り方は docs/SETUP.md → http://localhost:8000/admin/
#   書き方の見本は demo/admin.py。
# =============================================================================

from django.contrib import admin  # noqa: F401


# ★ここから書きはじめる
#
#   from main.models import Post
#
#   @admin.register(Post)
#   class PostAdmin(admin.ModelAdmin):
#       list_display = ("id", "title", "created_at")   # 一覧に並べる列
#       search_fields = ("title",)                     # 上に出る検索窓
