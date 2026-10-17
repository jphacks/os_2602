# =============================================================================
# models.py = データの形(DBの表)を決める場所
#
#   1つのクラス = DBの1つの表。1行 = 1件のデータ(class Post → main_post 表)。
#   この設計図があるおかげで、SQLを書かずに Post.objects.all() と書ける。
#
#   ★ユーザーの表は自分で作らない。Djangoに最初から付いてくる(User)。
#     パスワードの保存もログインの判定も入っている。
#
#   ★モデルを変えたら必ず2つのコマンドを打つ(実行方法は docs/SETUP.md):
#
#       python manage.py makemigrations   … 変更内容の指示書を作る
#       python manage.py migrate          … 指示書どおりにDBを変更する
#
#     忘れると「コードは直したのにDBが古いまま」でエラーになる。
#
# ▼ ★ここから書きはじめる
#
# 	from django.conf import settings
#
# 	class Post(models.Model):
# 	    title = models.CharField(max_length=200)
# 	    body = models.TextField(blank=True)
# 	    created_at = models.DateTimeField(auto_now_add=True)
#
# 	    # AUTH_USER_MODEL = ユーザーの表を指す決まった書き方。
# 	    # null/blank=True にすると持ち主なしでも保存できる。
# 	    user = models.ForeignKey(
# 	        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
# 	        null=True, blank=True, related_name="posts",
# 	    )
#
# 	    class Meta:
# 	        ordering = ["-id"]   # 取り出すときの並び順("-" で新しい順)
#
# 	    def __str__(self) -> str:
# 	        return self.title    # 無いと管理画面に「Post object (1)」と出る
# =============================================================================

from django.db import models  # noqa: F401
