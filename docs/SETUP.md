# 環境構築と日々の操作

このファイルは**困ったときに最初に見る紙**です。分からなくなったら人に聞く前にここを見てください。

> Pythonの**書き方**で詰まったときは [Pyhelp.md](Pyhelp.md) を見てください。
> JavaやPHPをやった人向けに、「あれはPythonだとどう書くか」をまとめてあります。
>
> **本番に出す**ときは [DEPLOY.md](DEPLOY.md) を見てください。
> このファイルに書いてあるのは、あくまで手元での開発の話です。

---

## 0. 準備するもの(初回だけ)

| ツール | 用途 | 確認コマンド |
| --- | --- | --- |
| Docker Desktop | アプリとDBを動かす箱 | `docker version` |
| Git | ソースコードの共有 | `git --version` |
| VSCode | エディタ(推奨) | — |

**Python を自分のPCに入れる必要はありません。** Dockerの箱の中に入っているものを使います。

> Docker Desktop は**起動しておく必要があります**。タスクバーのクジラのアイコンが動いていればOKです。
> PCを再起動すると止まっていることがあるので、`docker` コマンドが失敗したらまずこれを疑ってください。

---

## 1. 初回セットアップ(1回だけ、10分程度)

### ① リポジトリを持ってくる

```bash
git clone <リポジトリのURL>
cd case_django
```

### ② 金庫(`.env`)を作る

`.env` は**GitHubに上がっていません**(パスワードが入っているため)。見本をコピーして作ります。

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```

```bash
# Mac / Linux
cp .env.example .env
```

そのあと、`.env` の中身をチームで共有されたものに合わせてください。
**開発中はコピーしたままの値でも動きます。**

### ③ 箱を組み立てて起動する

```bash
docker compose up --build
```

初回は部品のダウンロードと組み立てで**5〜8分**かかります。2回目以降は数秒です。

ログが流れ終わって以下のような行が出たら成功です。

```
web-1  | Starting development server at http://0.0.0.0:8000/
```

> **DBに表を作るコマンドは不要です。** 起動のたびに自動で実行されます(`compose.yml` の `command`)。

### ④ ブラウザで確認

<http://localhost:8000> を開いてください。

- **「セットアップ完了 🎉」と出て、データベースが「接続OK」** → 成功です
- 下のTodoに文字を入れて「追加」できたら、**画面 ↔ サーバー ↔ DB が全部つながっています**
- 「未接続」と出る → DBの起動待ちの可能性があります。10秒待ってページを再読み込み
- 画面が出ない → 下の「困ったとき」へ

### ⑤ 管理画面に入るアカウントを作る

**Djangoの一番おいしい機能なので、必ずやってください。**

```bash
docker compose exec web python manage.py createsuperuser
```

ユーザー名・メール・パスワードを聞かれるので入力します(メールは空でEnterでOK)。

> パスワードは画面に表示されませんが、ちゃんと入力されています。

作れたら <http://localhost:8000/admin/> を開いてログインしてください。
**データの一覧・追加・編集・削除ができる画面が、コードを書かずに手に入ります。**

---

## 2. 毎日の操作(これだけ覚えれば作業できます)

### 作業を始めるとき

```bash
docker compose up
```

### 作業を終わるとき

```bash
# 上のターミナルで Ctrl + C を押す。それだけです。
# 完全に片付けたい場合:
docker compose down
```

### コードを直したとき

**何もしなくていいです。** ファイルを保存すれば反映されます。

| 直したファイル | どうなるか |
| --- | --- |
| `.py` | 自動で再起動(**2〜3秒**)→ ブラウザを再読み込み |
| `.html` / `.css` / `.js` | **1秒ほど**で反映 → ブラウザを再読み込み |

> CSSを直したのに変わらない場合は、**キャッシュ**(ブラウザが前の内容を覚えている状態)です。
> `Ctrl + Shift + R`(Macは `Cmd + Shift + R`)で強制的に読み直せます。

### ログ(エラーの内容)を見たいとき

```bash
docker compose logs -f web
```

**エラーが出たら、まずここを見ます。** `-f` は「流れ続ける」の意味で、止めるときは `Ctrl + C` です。

> Djangoは開発中、**ブラウザにもエラーの詳細を表示します。**
> どの行で落ちたか・そのとき変数に何が入っていたかまで出るので、
> ログよりブラウザの画面のほうが分かりやすいことが多いです。

### 箱の中に入って作業したいとき

```bash
docker compose exec web bash
```

箱の中のターミナルに入ります。出るときは `exit` です。

### コメントが多くて読みにくいとき(チーム開発時非推奨)

このテンプレートは覚えるための解説を厚く書いてあります。慣れてきて邪魔になったら、**自分の手元だけ**まとめて消せます。

### チーム開発時は使用非推奨とします。
チーム開発で使用する際は、**必ず最初に誰か一人がcloneしたときに実行**し、その直後に再度commit/pushするようにしてください。(ほぼすべての作業するファイルに変更が加わるため。)

```bash
# ① まず何行消えるか見るだけ(ファイルは変わりません)
docker compose exec web python tools/strip_comments.py --dry-run

# ② 実際に消す
docker compose exec web python tools/strip_comments.py

# ③ 元に戻す
docker compose exec web python tools/strip_comments.py --restore
```

消えるのは解説だけです。手順書(`docs/`)、`.env.example`、`# noqa` のような**道具への指示**は残ります。

> **★消した状態を commit / push しないでください。**
>
> コメントを消すと、そのファイルはGitから見て「全行が変わった」扱いになります。
> 1人がpushすると、残りの5人は自分の作業と**全ファイルで衝突**します。
> commitする前に `--restore` で戻してください。
> (未コミットの変更があるときは、混ざらないように実行を止めるようにしてあります)

---

## 3. データベースの操作

### ★Djangoでいちばん大事なルール

**`models.py` を変えたら、必ず次の2つを打ちます。**

```bash
# 1. 「どう変えたか」の指示書を作る
docker compose exec web python manage.py makemigrations

# 2. 指示書どおりにDBを変更する
docker compose exec web python manage.py migrate
```

> **`makemigrations` を忘れると何も起きません。**
> モデルを直しただけではDBは変わらないので、「保存できない」「そんな列は無い」
> というエラーになります。

### ★作られた指示書は必ずコミットする

`main/migrations/0002_....py` のようなファイルが作られます。**これをpushしてください。**

> ⚠️ 上げ忘れると、**他のメンバーのDBだけ古い形のまま**になり、
> その人の環境でだけエラーが出ます。原因が分かりにくい事故の代表例です。
> pullした人は `docker compose exec web python manage.py migrate` を打てば揃います。

### 列を増やしたいだけなら、データは消えません

Djangoは「既にあるデータを保ったまま形を変える」のが得意です。
列を増やすときに「既存の行には何を入れる?」と聞かれたら、
`1` を選んで、その場で初期値(例:空文字なら `""`)を入力すればOKです。

### DBを丸ごと作り直したいとき(最終手段)

```bash
docker compose down -v
docker compose up --build
```

`-v` を付けると**保管庫ごと消える**ので、DBが完全に初期状態に戻ります。
**中のデータは全部消えます。** 管理者アカウントも作り直しになります。

> 📌 **デモを `demo/` に移す前から動かしていた人へ**
> DBに `main_todo` という使われない表が残っています。害はありませんが、
> 気になる場合は上のコマンドで作り直すと消えます(今後は `demo_todo` が使われます)。

---

## 3.5 DBeaverでDBの中身を見る

### 接続設定

`docker compose up` でDBが起動している状態で、DBeaverから新しい接続を作ります。

| 項目 | 値 |
| --- | --- |
| ドライバ | MySQL |
| Server Host | `localhost` |
| **Port** | **`3309`** |
| Database | `hack_app` |
| Username | `hack_user` |
| Password | `hack_password` |

> ⚠️ **ポートは 3306 ではなく 3309 です。**
> PCに既にMySQLが入っている人や、Flask版(3307)・Gin版(3308)と
> 同時に動かす場合にぶつからないよう、`compose.yml` でずらしています。
> (アプリ側は箱の中で `db:3306` に繋いでいるので、この番号とは無関係です)

### 「Public Key Retrieval is not allowed」と出たら

MySQL 8 のログイン方式のためです。接続設定の **Driver properties** で以下を変更してください。

| プロパティ | 値 |
| --- | --- |
| `allowPublicKeyRetrieval` | `true` |
| `useSSL` | `false` |

開発用のローカルDBなので、これで問題ありません。

### 管理者として入りたいとき

| Username | Password |
| --- | --- |
| `root` | `root_password` |

### 見ておくと理解が早いところ

- `main_todo` テーブル → `main/models.py` に書いた設計図がそのまま形になっています
  (表の名前が「アプリ名_モデル名」になるのがDjangoの決まりです)
- `auth_user` テーブル → **自分で作っていないのに存在します。** Djangoが用意してくれたものです
- `auth_user` の `password` 列 → 保存されているのが**元に戻せない文字列**であることが目で確認できます
- `django_migrations` テーブル → どの指示書まで適用済みかの記録です

> **DBeaverを開かなくても、たいていは <http://localhost:8000/admin/> で足ります。**
> 中身を見るだけなら管理画面のほうが速いです。

---

## 4. ライブラリを追加したいとき

例:画像処理の `Pillow` を使いたくなった場合。

1. `pyproject.toml` の `dependencies` に1行足す

```toml
dependencies = [
    "Django==5.2.17",
    ...
    "Pillow",   # ← 追加
]
```

2. 箱に反映する

```bash
docker compose exec web uv sync
docker compose restart web
```

3. **`pyproject.toml` と `uv.lock` をコミットしてpushする**

> ⚠️ **これを共有しないと、他のメンバーの環境で `ModuleNotFoundError` が出ます。**
> pull した人は `docker compose exec web uv sync` を実行すれば揃います。

---

## 5. 困ったとき

### 「画面が出ない / 繋がらない」

```bash
docker compose ps
```

`web` と `db` の両方が `running` になっているか確認します。

- `web` が居ない/落ちている → `docker compose logs web` でエラーを読む
- `db` が `starting` → まだ準備中です。30秒待つ

### 「port is already allocated」と出る

**その番号を別のアプリが既に使っています。**

- `8000` の場合:`compose.yml` の `"8000:8000"` を `"8001:8000"` に変更 → <http://localhost:8001>
- `3309` の場合:`"3309:3306"` を `"3310:3306"` に変更

> **左の数字だけ**を変えてください。右はアプリ側の番号なので変えると動きません。

### 「no such table」「Table 'xxx' doesn't exist」

**DBに表がまだありません。**

```bash
docker compose exec web python manage.py migrate
```

それでも直らない場合は、`makemigrations` を忘れています(上の「3. データベースの操作」)。

### 「You have N unapplied migration(s)」と黄色い文字が出る

誰かが作った指示書がまだ適用されていません。

```bash
docker compose exec web python manage.py migrate
```

### 「{% extends %} must be the first tag」

**`{% extends "base.html" %}` はファイルの1行目に書く決まりです。**

その上にコメント(`{% comment %}`)を書くとこのエラーになります。
説明を書きたいときは `extends` の**下**に書いてください。

### 「Invalid block tag ... did you forget to register or load this tag?」

HTMLの書き間違いです。よくある原因:

- `{% if %}` や `{% for %}` を `{% endif %}` `{% endfor %}` で閉じていない
- `{% static %}` を使う前に `{% load static %}` を書いていない
- タグの名前のスペルミス

### 「CSRF verification failed」「Forbidden (403)」

フォームに**整理券を入れ忘れています**。HTMLのフォームの中に次の1行があるか確認してください。

```html
{% csrf_token %}
```

JavaScriptから送っている場合は、`main.js` の `api.post()` を使ってください(整理券が自動で付きます)。

### 「DisallowedHost at /」と出る

`.env` の `DJANGO_ALLOWED_HOSTS` に、アクセスに使っているドメインが入っていません。
本番でサブドメインを使うときは、そこに追記してください。

### 画面に値が出ない / 空っぽになる

`{{ title }}` のように書いても、**渡していない情報は空になります**(エラーにもなりません)。

確認する順番:

1. `views.py` の `render(request, "○○.html", {...})` にその名前を書いたか
2. 名前のスペルが一致しているか
3. `{% block content %}` の**中**に書いてあるか(blockの外は表示されません)

### 「値が届かない / 空っぽになる」(フォーム)

HTMLの `name="○○"` と、Pythonの `request.POST.get("○○")` の**文字が一致しているか**を確認してください。ここのズレが原因の8割です。

### CSSやJSが反映されない

- `{% load static %}` をファイルの上のほうに書いたか
- ブラウザのキャッシュ → `Ctrl + Shift + R`

### VSCodeに「パッケージ 'django' がインストールされていません」と出る

**無視してOKです。** 部品は箱の中に入っているので、アプリは正常に動きます。

VSCodeは自分のPC側で動いているため、箱の中の部品が見えていないだけです。
そのため補完や定義ジャンプは効きませんが、**動作には一切影響しません。**

### それでも分からないとき

以下の3つをセットでチームに投げてください。**これが揃っていれば誰でも助けられます。**

1. 何をしようとしたか
2. `docker compose logs web` の最後20行
3. ブラウザに出ている画面(スクリーンショット)
   ※ Djangoのエラー画面は情報が多いので、**上から1画面分**を撮ってください

---

## 6. よく使うコマンド一覧

| やりたいこと | コマンド |
| --- | --- |
| 起動する | `docker compose up` |
| 止める | `docker compose down` |
| エラーを見る | `docker compose logs -f web` |
| モデルの変更を反映する | `docker compose exec web python manage.py makemigrations` → `migrate` |
| 管理者を作る | `docker compose exec web python manage.py createsuperuser` |
| 新しいアプリを作る | `docker compose exec web python manage.py startapp <名前>` |
| 対話画面でDBを触る | `docker compose exec web python manage.py shell` |
| 設定の問題を調べる | `docker compose exec web python manage.py check` |
| 書き方をチェック | `docker compose exec web ruff check .` |
| コメントを消す(手元だけ) | `docker compose exec web python tools/strip_comments.py` |
| 消したコメントを戻す | `docker compose exec web python tools/strip_comments.py --restore` |
| 箱の中に入る | `docker compose exec web bash` |

---

## 7. 本番(AWS)に出すとき

**ハッカソン中は不要です。** 手順は専用のファイルにまとめてあります。

→ **[DEPLOY.md](DEPLOY.md)**

本番は `compose.prod.yml` という別のファイルで動かします。
`.env` の書き換え、Nginx、HTTPS、困ったときの対処まで、全部あちらに書いてあります。

> ★ここに手順を二重に書かないでください。
> 2か所にあると必ず片方が古くなり、「書いてある通りにやったのに動かない」が起きます。
