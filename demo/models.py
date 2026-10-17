# =============================================================================
# デモ用のデータの形。
#
#   ★このアプリは DEBUG=True のときだけ読み込まれるので、
#     この表(demo_todo)は本番のDBには作られません。
#
#   自分たちの表は main/models.py に書きます。書き方の見本としてどうぞ。
#
# ▼ ★デモは本番のモデルに一切ぶら下がりません
#
#   以前ここには User への紐付け(ForeignKey)がありましたが、外しました。
#   紐付けがあると、
#     ・デモのマイグレーションが本番の User に依存する
#     ・本番の User に user.todos という項目が生える(related_name)
#   という形で、消したはずのデモが本番側に痕跡を残します。
#
#   デモはデモだけで完結させ、本番側には何も残さない方針にしています。
#   紐付けの書き方の見本は main/models.py にあります。
# =============================================================================

from django.db import models


class Todo(models.Model):
    """やることリスト1件分(デモ)。"""

    # ★ID(1,2,3…の通し番号)は書かなくても自動で作られる。

    title = models.CharField(max_length=200)
    is_done = models.BooleanField(default=False)

    # auto_now_add=True = 保存時に現在時刻を自動で入れる。入れ忘れる事故がなくなる。
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # 取り出すときの並び順。"-" を付けると新しい順。
        # ★ここで決めておくと、取得のたびに並び替えを書かなくて済む。
        ordering = ["-id"]

    def __str__(self) -> str:
        """管理画面などで1件を表す文字。これが無いと「Todo object (1)」と出る。"""
        return self.title

    def to_dict(self) -> dict:
        """JavaScriptに渡せる形(JSONにできる辞書)に変換する。

        ★ここで返す形が、そのままJavaScript側で受け取る形になる。
          項目名を変えるときは demo/templates/demo/index.html のJSも一緒に直す。
        """
        return {
            "id": self.id,
            "title": self.title,
            "is_done": self.is_done,
            "created_at": self.created_at.isoformat(),
        }
