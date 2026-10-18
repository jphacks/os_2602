# =============================================================================
# context_processors.py = 全ページで自動的に使える情報を足す場所
#
#   ここに書いた値は、ビューから毎回渡さなくてもどのHTMLからでも使える
#   ({{ SITE_NAME }} など)。登録は config/settings.py に済ませてある。
#
#   ※ {{ user }} と {{ messages }} はDjangoが用意しているので書かなくてよい。
#
#   検索結果とSNSでの見え方もここで用意している(使うのは base.html の <head>)。
# =============================================================================

from django.conf import settings

# =============================================================================
# ★サイトの基本情報。ここ3つを直せば全ページに反映される。
# =============================================================================

# SITE_NAME = サイトの表示名。全ページのタイトルとヘッダーに出る。
SITE_NAME = "dether"

# SITE_DESCRIPTION = 説明文を渡さなかったページで使われる文章。
#
# 検索結果でタイトルの下に出る2行、SNSに貼ったときの説明文がこれになる。
#
# ★120文字前後に収めること。長いと検索結果で途中から切られる。
# ★ページごとに変えたいときは、render(...) に "description" を渡す。
SITE_DESCRIPTION = (
    "調査ボタンで身の回りの音を測り、うるさい場所や静かな場所でバッジを集める位置情報ゲーム。"
    "みんなの記録が、どこでどんな音が鳴っているかがわかる街の騒音マップになります。"
)

# OGP_IMAGE = SNSに貼ったときに出るサムネイル画像。
#
# ★空のときは画像用のタグを出さない。画像が無いのにタグだけ出すと、
#   SNS側が「画像が取れない」と判断してカードが小さいまま表示される。
# 用意するとき: 1200x630 の画像を static/images/ogp.png に置き、
#               ここを "/static/images/ogp.png" にする。
OGP_IMAGE = ""


def site_settings(request) -> dict:
    """全ページで使う共通の情報を返す。"""
    # ★ドメインは設定に書かず、アクセスされたURLから組み立てている。
    #   設定に書くと開発中(localhost)と本番で食い違い、片方が必ず間違う。
    # ★本番でHTTPSと分かるのは settings.py の SECURE_PROXY_SSL_HEADER のおかげ。
    #   Nginx と Django の間はHTTPなので、それが無いと http:// を出してしまう。
    return {
        "SITE_NAME": SITE_NAME,
        "SITE_DESCRIPTION": SITE_DESCRIPTION,
        "OGP_IMAGE": OGP_IMAGE,
        # 地図(templates/map.html)が使う。値は .env の GOOGLE_MAPS_API_KEY / GOOGLE_MAP_ID
        "GOOGLE_MAPS_API_KEY": settings.GOOGLE_MAPS_API_KEY,
        "GOOGLE_MAP_ID": settings.GOOGLE_MAP_ID,
        # 末尾のスラッシュを落としているのは、画像のURLを
        # site_url + "/static/..." と繋ぐときに "//" にならないようにするため。
        "site_url": request.build_absolute_uri("/").rstrip("/"),
        # ★request.path を渡して ?以降 を落としている。
        #   ?utm_source=... が付いただけのURLを別ページとして数えられると、
        #   検索エンジンからの評価が分散します。
        "canonical_url": request.build_absolute_uri(request.path),
    }
