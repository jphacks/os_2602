"""見えないアカウント（③データ担当）

初回アクセスでランダムな名前のユーザーを自動で作り、そのままログイン状態にする。
config/settings.py の MIDDLEWARE で AuthenticationMiddleware の「後ろ」に1行足す（④にお願いする）:
    "main.middleware.InvisibleAccountMiddleware",
"""

import random
import secrets

from django.contrib.auth import get_user_model, login

ADJECTIVES = ["静かな", "にぎやかな", "眠たい", "耳のいい", "夜ふかしの", "早起きの", "のんびりした", "小さな"]
ANIMALS = ["フクロウ", "コウモリ", "ネコ", "キツネ", "ウサギ", "セミ", "スズメ", "タヌキ"]

# ここで始まるURLではユーザーを作らない（管理画面・管理者ログイン・静的ファイルなど）
SKIP_PREFIXES = ("/admin", "/accounts", "/static", "/media", "/sw.js", "/favicon.ico")


def random_username():
    # username は重複できないので、後ろに短いIDを付ける（例：静かなフクロウ-3f9a2c）
    return f"{random.choice(ADJECTIVES)}{random.choice(ANIMALS)}-{secrets.token_hex(3)}"


def display_name(user):
    """画面に出す名前（例：静かなフクロウ）"""
    return user.username.rsplit("-", 1)[0]


class InvisibleAccountMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.user.is_authenticated and not request.path.startswith(SKIP_PREFIXES):
            User = get_user_model()
            user = User(username=random_username())
            user.set_unusable_password()  # パスワードではログインできないユーザーにする
            user.save()
            login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return self.get_response(request)
