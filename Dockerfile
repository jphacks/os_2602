# =============================================================================
# アプリを動かす箱の作り方
#
#   上から順に実行される。Dockerは「前回と同じ工程は結果を再利用」するので、
#   変わりにくい作業(部品のインストール)を先に、よく変わる作業(コードの
#   コピー)を後に書く。こうすると2回目以降のビルドが数秒で終わる。
#
#   ▼ このファイルには箱が3つ書いてある(段階に分けている)
#       base … 部品を入れる工程(共通)
#       dev  … 開発用(★ハッカソン中に使うのはこれだけ)
#       prod … 本番用の完成品
#
#     compose.yml で target: dev と指定しているので、開発中は dev だけが作られる。
# =============================================================================

# -----------------------------------------------------------------------------
# base = 部品を入れる工程
# -----------------------------------------------------------------------------
FROM python:3.13-slim AS base

# uv = 部品を入れる係(pipの代替で高速)。本体だけコピーするので速い。
# ★latest にすると突然の更新でビルドが壊れるのでバージョンを固定する。
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    # ↑ printの結果をすぐ出す(ログが遅れると原因調査しづらい)
    PYTHONDONTWRITEBYTECODE=1 \
    DJANGO_SETTINGS_MODULE=config.settings \
    # ↑ Djangoに「設定は config/settings.py にある」と教える
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    # ↑ ★部品の置き場所。既定の /app/.venv だと、開発時に自分のPCの
    #   フォルダで /app が上書きされて部品が消える。だから外に置く。
    PATH="/opt/venv/bin:$PATH" \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    TZ=Asia/Tokyo

WORKDIR /app

# ★MySQLとの通訳(mysqlclient)を作るのに必要な道具。
#   この部品だけは「入れる時に組み立てる」形で配られているため、
#   組み立て道具(build-essential など)が要る。
#   組み立て済みのものが配られていないので、これは省略できない。
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        default-libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/*

# ★買い物リストだけ先にコピーする理由
#   全ファイルを先にコピーすると、HTMLを1文字直すたびに部品の再インストールが
#   走る。リストだけ渡せば、リストが変わらない限り再インストールは起きない。
# uv.lock* の * は「あってもなくてもいい」(初回は存在しない)。
COPY pyproject.toml uv.lock* ./

RUN uv sync

# -----------------------------------------------------------------------------
# dev = 開発用の箱(compose.yml から使われるのはこれ)
# -----------------------------------------------------------------------------
FROM base AS dev

# コピーしないものは .dockerignore に書いてある。
COPY . .

EXPOSE 8000

# 0.0.0.0 が必要な理由:
#   指定しないと箱の中からしかアクセスできず、
#   「起動してるのに画面が出ない」状態になる。
#
# ★実際に動かすコマンドは compose.yml の command で指定している
#   (起動前にDBの表を用意するため)。ここはその既定値。
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# -----------------------------------------------------------------------------
# prod = 本番用の完成品(AWSに置くのはこれ)
#
#   ★組み立て道具を持ち込まない
#     base で組み立てた部品(/opt/venv)だけを移してくるので、
#     本番の箱には組み立て道具が入らない。軽くなるうえ、
#     万一侵入されたときに使える道具が少なくなる。
# -----------------------------------------------------------------------------
FROM python:3.13-slim AS prod

# 組み立て済みの通訳が動くために必要な、実行時だけのライブラリ。
RUN apt-get update && apt-get install -y --no-install-recommends \
        libmariadb3 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DJANGO_SETTINGS_MODULE=config.settings \
    PATH="/opt/venv/bin:$PATH" \
    TZ=Asia/Tokyo

WORKDIR /app

COPY --from=base /opt/venv /opt/venv
COPY . .

EXPOSE 8000

# gunicorn = 本番用のサーバー。
#   開発用のサーバー(runserver)は同時に1人しか捌けず、本番では使えない。
#   --workers 3 = 3人分の窓口を用意する。
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
