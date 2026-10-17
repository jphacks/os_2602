# =============================================================================
# app.inc = HTTP版・HTTPS版の両方から読み込む「中身」の設定
#
#   このフォルダには設定が2枚ある(prod.conf / prod-https.conf)。
#   中身は両方で同じなので、この1枚に書いて両方から読み込んでいる。
#   ★中身を直すときは常にここ1か所。2枚に同じことを書くと、
#     片方だけ直して「HTTPSにした途端に画像が出ない」になる。
# =============================================================================

# アップロードの上限。超えると Nginx が 413 で弾く。
# ★settings.py の DATA_UPLOAD_MAX_MEMORY_SIZE と同じ値にしておくこと。
client_max_body_size 16M;

# --- 圧縮 ---
# CSS・JS・HTMLは文字の塊なので、送る前に圧縮すると 1/4〜1/5 になる。
# ★画像(jpg/png/ico)は既に圧縮済みなので対象にしない。svg は中身が文字なので入れる。
gzip on;
gzip_min_length 1024;
gzip_comp_level 6;

# ★text/html は書かなくても常に対象。書くと重複警告が出る。
gzip_types
    text/css
    text/plain
    application/javascript
    application/json
    image/svg+xml;

gzip_vary on;

# --- CSS / JS / 画像(collectstatic が集めたもの) ---
location /static/ {
    alias /var/www/static/;
    expires 30d;
    access_log off;
}

# --- 利用者が上げたファイル ---
# ★こちらは箱の外の保管庫にあるので、箱を作り直しても消えない。
location /media/ {
    alias /var/www/media/;
    expires 30d;
    access_log off;
}

# --- それ以外は全部 Django に渡す ---
location / {
    # "web" は compose.prod.yml のサービス名。Dockerが住所に変換する。
    proxy_pass http://web:8000;

    # ★この4行が無いと、Django から見た相手が全部 Nginx になる。
    #   特に X-Forwarded-Proto が無いと、HTTPSで来ているのにHTTPだと勘違いして
    #   リダイレクトが延々ループする(settings.py の SECURE_PROXY_SSL_HEADER と対)。
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 120s;
}
