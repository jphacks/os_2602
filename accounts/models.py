# =============================================================================
# models.py = このアプリが使うDBの表
#
#   ★利用者の表(User)はここに無い。Djangoが最初から用意しているものを使う。
#     このファイルは下の LoginAttempt のために作られている。
# =============================================================================

from django.db import models


# =============================================================================
# LoginAttempt = ログインの失敗を数えておく表
#
#   数え方と締め出しの判断は accounts/loginlimit.py。ここは置き場所の形だけ。
#
#   ▼ ★なぜアプリの中の変数ではなくDBに置くのか
#
#     本番では gunicorn が3つのプロセスでアプリを動かす(Dockerfile の
#     --workers 3)。変数に数えるとプロセスごとに別々に数えるので、
#     「5回まで」のつもりが実質15回になる。
#     ★見た目は動いているのに効いていない、という最悪の形になる。
#
#   ★表を追加したので、初回だけ migrate が要る(設計図は migrations/ にある)。
#     開発用の compose.yml は起動時に自動で migrate するので、普段は何もしない。
# =============================================================================
class LoginAttempt(models.Model):
    # ★「アカウントごと」ではなく「アクセス元ごと」に数える。
    #   アカウントごとだと、他人がわざと5回間違えるだけで本人が締め出される。
    #
    # GenericIPAddressField = IPを入れる専用の型。長さを決めなくてよく、
    # 形が違う値を弾いてくれる。
    ip = models.GenericIPAddressField(unique=True)

    # 続けて失敗した回数。1回でも成功したら記録ごと消える。
    count = models.PositiveIntegerField(default=0)

    # 古い記録を捨てる判断に使う。
    last_failure_at = models.DateTimeField()

    # この時刻まで締め出す。
    #
    # ★null=True が必要。「失敗を数えている途中」を表すため。
    #   空にできないと未設定を時刻で表すしかなくなり、必ず
    #   「もう過ぎている」と判定されて締め出しが働かない。
    locked_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "login_attempts"

    def __str__(self) -> str:
        return f"{self.ip}: {self.count}回"
