# =============================================================================
# settings.py = 設定を1か所に集める場所
#
#   .env(金庫) ──読む──> settings.py ──使う──> Django全体
#
#   コード内に直接パスワードやDB住所を書くと、変更時に全ファイルを探し回るうえ、
#   GitHubに秘密を上げてしまう。
#
# ▼ ★Djangoの特徴:設定ファイルが1枚に集約されている
#
#   「どの機能を使うか」「DBはどこか」「HTMLはどこにあるか」を全部ここで決める。
#   逆にいうと、ここに書いていない機能は動かない。
#   何かを追加したとき「動かない」場合は、まずここへの記入漏れを疑う。
#
# ▼ このファイルは基本的に触らない
#
#   触るのは「アプリ(担当のフォルダ)を新しく作ったとき」だけ。
#   その場合は下の INSTALLED_APPS に1行足す。
# =============================================================================

import os
from pathlib import Path

from dotenv import load_dotenv

# このファイルは <プロジェクト>/config/settings.py なので、親を2回たどると入口。
# こう書いておけば、どこから起動しても .env を見つけられる。
BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def _env_bool(key: str, default: bool = False) -> bool:
    """.env の "True"/"False" という文字を、Pythonの True/False に変換する。

    .env に書けるのは文字だけなので、"False" をそのまま使うと
    「中身のある文字 = True」と判定されてしまう。その事故を防ぐ。
    """
    value = os.getenv(key)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


# =============================================================================
# 基本の設定
# =============================================================================

# ログイン状態をブラウザに預けるときの割り印。
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-secret-key-change-me")

# True にすると、エラーの原因が画面に詳しく出る + 保存すると自動で再起動する。
# ★本番では必ず False。True のままだと設定やソースの中身が外部に丸見えになる。
DEBUG = _env_bool("DJANGO_DEBUG", True)

# ★アクセスを許可するドメインの一覧。
#   ここに無いドメインでアクセスすると「Bad Request (400)」になる。
#   本番でサブドメインを使うときは .env に追記する。
ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

# 本番でフォーム送信を許可する送信元。https:// から書く必要がある。
# 例: https://app.example.com
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]

# False にすると、ログイン関連のURLを登録しない(config/urls.py で使っている)。
AUTH_ENABLED = _env_bool("AUTH_ENABLED", True)


# =============================================================================
# 使う機能(アプリ)の一覧
#
#   Djangoでは機能のまとまりを「アプリ」と呼ぶ。お店でいう売り場で、
#   1つの売り場にモデル・ビュー・URLがセットで入っている。
#   ★django.contrib.* は最初から付いてくる売り場。これがDjangoの最大の強み。
# =============================================================================

INSTALLED_APPS = [
    # --- Django標準で付いてくるもの ---
    "django.contrib.admin",  # 管理画面(データを画面から追加・編集できる)
    "django.contrib.auth",  # ログイン・ユーザー管理
    "django.contrib.contenttypes",
    "django.contrib.sessions",  # ブラウザに小さなメモを持たせる仕組み
    "django.contrib.messages",  # 「保存しました」を次の画面に出す仕組み
    "django.contrib.staticfiles",  # CSS / JS / 画像を配る係
    # --- 自分たちで作った売り場 ---
    # ★新しく python manage.py startapp ○○ したら、ここに1行足す。
    #   忘れると、そのアプリのモデルもURLも認識されない。
    "main",  # 画面とAPI
    "accounts",  # ログイン・新規登録
]

# --- デモ(動作確認用のページ) ---
# ★開発モードのときだけ読み込む。
#   本番では読み込まれないので、デモ用の表(demo_todo)も本番のDBには作られない。
if DEBUG:
    INSTALLED_APPS += ["demo"]


# =============================================================================
# ミドルウェア = 全部の通り道に置いておく仕掛け(お店の入口の検温器)
#
#   ★並び順に意味がある。上から順に通るので、セッション(メモを読む)より
#     先にログイン確認は置けない。基本は触らないこと。
# =============================================================================

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    # 成りすまし送信を防ぐ仕掛け(CSRF対策)。
    # これがあるので、フォームに {% csrf_token %} を1行入れるだけで守られる。
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"


# =============================================================================
# HTMLの置き場所
# =============================================================================

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # ★ここに書いた場所からHTMLを探す。
        #   templates/ をプロジェクト直下にまとめているので、
        #   フロント担当は1か所だけ見ればよい。
        "DIRS": [BASE_DIR / "templates"],
        # アプリごとの templates/ フォルダも探す(今回は使っていない)。
        "APP_DIRS": True,
        "OPTIONS": {
            # ★context_processors = 「全ページで自動的に使える情報」の一覧
            #
            #   Djangoの便利なところで、ここに登録された情報は
            #   ビューから毎回渡さなくても、どのHTMLからでも使える。
            #       {{ user }}     … 今アクセスしている人
            #       {{ messages }} … 「保存しました」などのメッセージ
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                # 自作。{{ SITE_NAME }} と {{ AUTH_ENABLED }} を全ページで使えるようにする。
                "main.context_processors.site_settings",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# =============================================================================
# データベース
# =============================================================================

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.mysql",
        "NAME": os.getenv("DB_NAME", "hack_app"),
        "USER": os.getenv("DB_USER", "hack_user"),
        "PASSWORD": os.getenv("DB_PASSWORD", "hack_password"),
        "HOST": os.getenv("DB_HOST", "db"),
        "PORT": os.getenv("DB_PORT", "3306"),
        "OPTIONS": {
            # utf8mb4 は絵文字も扱える指定(utf8 だと絵文字でエラーになる)。
            "charset": "utf8mb4",
        },
        # DBとの回線は放置されると切られる。切れた回線に気づかず話しかけると
        # 「突然エラー」になるので、一定時間で繋ぎ直す。
        # 「しばらく放置したら動かなくなった」を防ぐ設定。
        "CONN_MAX_AGE": 280,
        "CONN_HEALTH_CHECKS": True,
    }
}

# 表のID列の型。指定しないと起動のたびに警告が出る。
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# =============================================================================
# パスワードの強さのチェック
#
#   「password」「12345678」のような危険なパスワードを弾いてくれる。
#   ★エラーメッセージは日本語で出る(下の LANGUAGE_CODE のおかげ)。
# =============================================================================

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# =============================================================================
# ログインの動き
# =============================================================================

# ログインが必要なページに未ログインで来た人を、どこへ案内するか。
LOGIN_URL = "/auth/login"

# ログイン後・ログアウト後の行き先。
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/"


# =============================================================================
# 言語と時刻
# =============================================================================

LANGUAGE_CODE = "ja"  # 管理画面とエラーメッセージが日本語になる
TIME_ZONE = "Asia/Tokyo"
USE_I18N = True

# ★DBには世界標準時で保存し、表示するときに日本時間へ直す方式。
#   時差のある場所から使われても狂わないので、そのままにしておく。
USE_TZ = True


# =============================================================================
# CSS / JS / 画像
# =============================================================================

STATIC_URL = "/static/"

# 開発中にここからファイルを配る。
STATICFILES_DIRS = [BASE_DIR / "static"]

# 本番用に1か所へ集めるときの置き場(docs/SETUP.md 参照)。
STATIC_ROOT = BASE_DIR / "staticfiles"


# =============================================================================
# アップロード(プロフィールアイコンなど、利用者が上げたファイル)
# =============================================================================

# ★static と media の違い(混同すると本番で画像が出ない)
#
#   static は自分たちが用意したものでGitに入れる。
#   media は利用者が上げたもので、消したら戻らない。
#   だから本番では media だけを箱の外の保管庫に置く。

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# 上限を決めておかないと、巨大ファイルでサーバーが落ちる。
DATA_UPLOAD_MAX_MEMORY_SIZE = 16 * 1024 * 1024  # 16MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 16 * 1024 * 1024


# =============================================================================
# 本番でだけ効かせる安全設定
# =============================================================================

if not DEBUG:
    SESSION_COOKIE_HTTPONLY = True  # JavaScriptから読めないようにする
    SESSION_COOKIE_SAMESITE = "Lax"  # 他サイトから勝手に使われるのを防ぐ

    # NginxをHTTPSの窓口にする場合、Djangoに「元はHTTPSだった」と伝える。
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    # ▼ ★本番でいちばんハマる設定
    #
    #   True = HTTPSのときだけログイン状態を持ち歩く。本番は True が正解。
    #
    #   ★HTTPのまま True にすると、ログインは成功しているのに次のページで
    #     必ずログイン画面に戻される。エラーも出ないので原因が分からない。
    #     練習中だけ .env に DJANGO_SECURE_COOKIES=False と書いて切る。
    SESSION_COOKIE_SECURE = _env_bool("DJANGO_SECURE_COOKIES", True)
    CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
