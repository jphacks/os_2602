# =============================================================================
# デモ用のデータを管理画面から見られるようにする設定。
#
#   自分たちのモデルは main/admin.py に登録します。書き方の見本としてどうぞ。
# =============================================================================

from django.contrib import admin

from demo.models import Todo


@admin.register(Todo)
class TodoAdmin(admin.ModelAdmin):
    """Todoを管理画面で扱うときの見せ方。"""

    # 一覧に並べる列。書かないと文字が1列出るだけで見づらい。
    list_display = ("id", "title", "is_done", "created_at")

    # 右側に出る絞り込み。
    list_filter = ("is_done", "created_at")

    # 上に出る検索窓。ここに書いた項目が検索対象になる。
    search_fields = ("title",)

    # 一覧の画面から直接チェックを付け外しできるようにする。
    list_editable = ("is_done",)
