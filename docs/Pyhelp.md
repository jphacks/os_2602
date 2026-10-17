# Python早わかり — コーディング経験者向け

このファイルは**Pythonを一から学ぶ教科書ではありません。**

授業でコーディングをやったなら、変数・条件分岐・繰り返し・クラスといった土台はもう持っています。足りないのは「Pythonだとどう書くか」だけです。(今回はJavaとPHPを基に作成)ここはその**書き換え表**です。

> 引っ越しに例えると、家具（考え方）はもう持っていて、新しい部屋の**間取りに合わせて置き直すだけ**です。家具を買い直す必要はありません。

分からなくなったら、この順で見てください。

1. まずこのファイルで書き方を確認する
2. 実際に動いているコードを読む（`demo/` の中が全部お手本です）
3. それでもダメなら人に聞く

---

## 0. 最初の3つのショック

Pythonのコードを初めて見ると、たいてい同じ3つで面食らいます。**慣れれば全部いいことです。**

### ① 波かっこ `{ }` が無い。代わりに**字下げ**が意味を持つ

```java
// Java
if (title.isEmpty()) {
    return "空です";
}
```

```python
# Python
if not title:
    return "空です"
```

かっこの代わりに、**行頭のスペース4つ**が「この中身だよ」を表します。

> ★これがPythonで一番の事故ポイントです。
> 字下げがずれると、**動くけれど意図と違う**という一番厄介な壊れ方をします。
>
> 心配は要りません。**Tabキーを押すとスペース4つが入る設定**になっていて、
> 保存すると自動で整形もされます（`.vscode/settings.json` に入れてあります）。
> 自分で数える必要はありません。

### ② 行末のセミコロン `;` が要らない

改行がそのまま「文の終わり」です。付けてもエラーにはなりませんが、**誰も付けません。**

### ③ 型を書かない

```java
String title = "こんにちは";     // Java
int count = 3;
```

```python
title = "こんにちは"             # Python
count = 3
```

`String` や `int` を書きません。**入れたもので勝手に決まります。**

> 「型が無い」のではなく「書かなくても分かってくれる」だけです。
> 文字と数字を足そうとすればちゃんと怒られます。

---

## 1. 変数

書き方の違いはこれだけです。

| | Java / PHP | Python |
| --- | --- | --- |
| 宣言 | `String name = "太郎";` / `$name = "太郎";` | `name = "太郎"` |
| 名前の付け方 | `userName`（キャメル） | `user_name`（**アンダースコア区切り**） |
| 定数 | `final int MAX = 10;` | `MAX = 10`（**大文字にするだけの約束**） |

> Pythonに「変更禁止」の仕組みはありません。
> 大文字で書いてあったら「触るなという意味だな」とお互いに読むだけの、**紳士協定**です。

---

## 2. 条件分岐

```java
// Java
if (count > 10) {
    ...
} else if (count > 5) {
    ...
} else {
    ...
}
```

```python
# Python
if count > 10:
    ...
elif count > 5:      # ★ else if ではなく elif
    ...
else:
    ...
```

**条件をかっこで囲む必要もありません。** 行末の `:`（コロン）を忘れがちなので注意してください。

### `&&` `||` `!` は英語になります

| Java / PHP | Python |
| --- | --- |
| `&&` | `and` |
| `\|\|` | `or` |
| `!` | `not` |

```python
if title and len(title) <= 200:
    ...
```

### 「空っぽ」の判定がすごく短く書けます

Pythonでは、**空の文字列・空のリスト・0・None が、そのまま「偽」として扱われます。**

```java
if (title == null || title.isEmpty()) { ... }   // Java
```

```python
if not title:                                   # Python はこれだけ
    ...
```

> 財布に例えると、Javaは「財布はあるか？」「中身は入っているか？」と2回聞きます。
> Pythonは「使えるお金ある？」の一言で済みます。

`demo/api.py` にも実際に出てきます。

```python
if not title:
    return json_response({"error": "内容を入力してください。"}, status=400)
```

---

## 3. 繰り返し

Pythonの `for` は、**中身を1つずつ取り出す形**しかありません。カウンタを回す書き方はしません。

```java
// Java
for (int i = 0; i < todos.size(); i++) {
    System.out.println(todos.get(i));
}
```

```python
# Python
for todo in todos:
    print(todo)
```

> 箱の中のみかんを1個ずつ取り出す、という書き方だと思ってください。
> 「何番目か」を数えながら手を伸ばす必要はありません。

### 回数を指定したいとき

```python
for i in range(5):      # 0,1,2,3,4 の5回
    print(i)
```

### 番号も一緒に欲しいとき

```python
for i, todo in enumerate(todos):
    print(i, todo)      # 0 みかん / 1 りんご ...
```

### `while` はJavaとほぼ同じ

```python
while count < 10:
    count += 1          # ★ count++ は無い。+= を使う
```

> `++` と `--` はPythonにありません。**`+= 1` を使ってください。**

---

## 4. リストと辞書 ← ★ここが一番よく使う

Djangoを触っていて一番出てくるのがこの2つです。**ここだけは覚えてください。**

### リスト（Javaの配列・ArrayList）

```python
todos = ["みかん", "りんご", "ぶどう"]

todos[0]              # "みかん"（0から数える。ここはJavaと同じ）
todos[-1]             # "ぶどう"（★後ろから数えられる。Javaには無い）
len(todos)            # 3
todos.append("かき")  # 末尾に追加
```

### 辞書（JavaのHashMap、PHPの連想配列）

**JavaScriptのオブジェクトとほぼ同じもの**だと思ってください。

```python
todo = {"id": 1, "title": "みかんを買う", "is_done": False}

todo["title"]         # "みかんを買う"
todo["title"] = "..."  # 書き換え
```

> **見た目もJSONそのままです。** サーバーがJavaScriptに返しているのは、
> だいたいこの辞書です（`demo/models.py` の `to_dict()` がまさにこれを作っています）。

### ★ `.get()` を覚えると事故が減ります

無いキーを `[ ]` で取ろうとすると、その場でエラーになって画面が落ちます。

```python
data["title"]                # ★ title が無いと落ちる
data.get("title", "")        # 無ければ "" が返る。落ちない
```

> 自販機に例えると、`[ ]` は「売り切れだと機械が止まる」、
> `.get()` は「売り切れなら代わりのボタンを押してくれる」です。
>
> **利用者から送られてきたデータには必ず `.get()` を使ってください。**
> 何を送ってくるか分からないからです。`demo/api.py` もそうしています。

### True / False の書き方に注意

| Java / PHP | Python |
| --- | --- |
| `true` / `false` | `True` / `False`（**先頭が大文字**） |
| `null` | `None` |

---

## 5. 関数

```java
// Java
public String greet(String name) {
    return "こんにちは " + name;
}
```

```python
# Python
def greet(name):
    return "こんにちは " + name
```

`def` で始めて、戻り値の型も引数の型も書きません。

### 初期値を決められます

```python
def json_response(data, status=200):
    ...

json_response({"ok": True})            # status は 200
json_response({"error": "..."}, 400)   # status は 400
```

> `demo/api.py` の先頭にある関数がまさにこの形です。
> 「だいたい200だから、いちいち書きたくない」という横着が、そのまま書けます。

### ★ 戻り値を2つ以上返せます

Javaだとクラスを作るしかない場面ですが、Pythonはカンマで並べるだけです。

```python
def check_db():
    return "ok", ""          # 2つ返す

status, message = check_db() # 2つ受け取る
```

`demo/views.py` の `_check_db()` がこの書き方です。

### 名前の先頭の `_` は「内輪用」の印

```python
def _read_json(request):    # ← このファイルの中だけで使う関数
```

**Javaの `private` のつもり**です。ただし本当に隠れるわけではなく、
「外から呼ばないでね」というお願いです。ここも紳士協定です。

---

## 6. クラスと `self`

```java
// Java
class Todo {
    String title;
    Todo(String title) {
        this.title = title;
    }
    String show() {
        return this.title;
    }
}
```

```python
# Python
class Todo:
    def __init__(self, title):    # ← コンストラクタ
        self.title = title

    def show(self):               # ★ self を必ず1つ目に書く
        return self.title
```

対応はこうです。

| Java | Python |
| --- | --- |
| コンストラクタ | `__init__` |
| `this` | `self` |
| `this` は自動で使える | **`self` は引数に自分で書く** |

> ★これがPythonで2番目に多い事故です。
> `def show(self):` の `self` を書き忘れると、呼んだ瞬間にエラーになります。
>
> Javaが「自分」を勝手に渡してくれるのに対し、
> **Pythonは「これがあなた自身ですよ」と手渡しする**、と思ってください。
> 面倒ですが、その代わり何が起きているか見えます。

### Djangoのモデルは、この書き方の応用です

```python
class Todo(models.Model):        # ← models.Model を継承している
    title = models.CharField(max_length=200)
    is_done = models.BooleanField(default=False)
```

かっこの中の `models.Model` が「継承」です（Javaの `extends`）。
これを継承すると、**Djangoが勝手にDBの表を作ってくれます。**

> ここは処理を書く場所ではなく、**項目を並べるだけ**の場所です。
> `if` も `for` も出てきません。DBeaverで見える表の設計図を、そのまま文字にしているだけです。

---

## 7. 文字列

### 連結

```python
"こんにちは " + name          # + で繋げる（Javaと同じ）
```

### ★ f-string（これがすごく便利）

文字列の前に `f` を付けると、`{ }` の中に変数を直接書けます。

```python
name = "太郎"
print(f"こんにちは {name} さん")     # こんにちは 太郎 さん
```

> JavaScriptのバッククォート `` `こんにちは ${name}` `` と同じものです。
> **中身が `${ }` ではなく `{ }` だけ**という違いです。

### よく使うメソッド

```python
title.strip()          # 前後の空白を削る
title.lower()          # 小文字に
len(title)             # 文字数
str(3)                 # 数字を文字に
int("3")               # 文字を数字に
```

> `demo/api.py` の `str(data.get("title", "")).strip()` は、
> 「送られてきた title を、文字として受け取って、前後の空白を削る」を1行でやっています。
> **空白だけ送りつけられても弾けるように**、`.strip()` を必ず通しています。

---

## 8. `None`（Javaの `null`）

```python
todo = Todo.objects.filter(pk=todo_id).first()
if todo is None:
    return json_response({"error": "見つかりませんでした。"}, status=404)
```

> ★ `== None` ではなく **`is None`** と書くのがPythonの流儀です。
> どちらでも動きますが、`is` のほうが速くて確実なので、全員こう書きます。

---

## 9. `import`

```java
import java.util.List;                  // Java
```

```python
from django.db import models            # django.db の中の models を持ってくる
import json                             # json をまるごと持ってくる
```

> ★ **ファイルの一番上に書きます。** 途中に書くとエラーにはなりませんが、誰も読めなくなります。
>
> 使っていない import が残っていると、保存したときにエディタが警告を出します。
> 消していいのですが、**`# noqa: F401` と書いてあるものだけは消さないでください。**
> 「使っていないように見えるけど、読み込むこと自体に意味がある」という印です。

---

## 10. Djangoのコードで見かける、Pythonっぽい書き方

ここを知っておくと、テンプレートのコードが急に読めるようになります。

### `@` で始まる行（デコレータ）

```python
@require_http_methods(["POST"])
def create_todo(request):
    ...
```

これは**関数に貼る付箋**です。「この関数はPOSTのときだけ動かしてね」という注文を、
関数の中身を汚さずに外側から貼っています。

> 宅配便の箱に「われもの注意」のシールを貼るのと同じです。
> 中身は変えずに、扱い方だけ指定しています。

Djangoでは `@admin.register(...)` や `@login_required` などがよく出てきます。

### `[ ... for ... in ... ]`（リスト内包表記）

```python
[todo.to_dict() for todo in todos]
```

これは次と同じ意味です。

```python
result = []
for todo in todos:
    result.append(todo.to_dict())
```

> 「全部のTodoを、辞書に変換して並べたリスト」を1行で書いています。
> **無理に自分で書く必要はありません。** 読めれば十分です。

### `with` で始まる行

```python
with connection.cursor() as cursor:
    cursor.execute("SELECT 1")
```

**使い終わったら勝手に片付けてくれる**書き方です。
Javaの try-with-resources と同じで、閉じ忘れが起きません。

### `try` / `except`（Javaの try-catch）

```python
try:
    payload = json.loads(request.body)
except ValueError:
    return json_response({"error": "形式が正しくありません。"}, status=400)
```

**`catch` ではなく `except`** です。それ以外はJavaと同じ考え方です。

> ★ ここで囲むのは「利用者のせいで失敗しうる所」だけにしてください。
> 全部を囲むと、自分のバグまで握りつぶしてしまい、
> 「エラーは出ないのに動かない」という一番つらい状態になります。

---

## 11. ★つまずきポイント集

実際に一番よく起きる順です。**詰まったらまずここを見てください。**

### 1. `IndentationError` / 動くけど動きが変

字下げがずれています。**スペース4つ**に揃えてください。
タブとスペースが混ざっているのが原因のことが多いです。

### 2. `TypeError: show() missing 1 required positional argument`

クラスの中のメソッドに **`self`** を書き忘れています。

### 3. 行末の `:` を忘れた

`if`, `for`, `def`, `class` の行末には必ず `:` が付きます。

### 4. `True` を `true` と書いた

**先頭が大文字**です。`None` も同じです。

### 5. `KeyError`

辞書に無いキーを `[ ]` で取りました。**`.get()` に変えてください。**

### 6. モデルを直したのにDBが変わらない

Pythonの話ではなくDjangoの話ですが、**一番多い事故**です。

```bash
docker compose exec web python manage.py makemigrations
docker compose exec web python manage.py migrate
```

**この2つを打つまでDBは何も変わりません。** 詳しくは [SETUP.md](SETUP.md) を見てください。

### 7. HTMLに書いたのに画面に出ない

これもDjangoの話です。`{% block content %}` の**外側に書いたものは無視されます**。
エラーも出ないので気づきにくいです。中に入れてください。

---

## 12. 練習にちょうどいい場所

**読むだけで一番勉強になるのは `demo/` の中です。** 動いているコードなので、間違いがありません。

| 見るファイル | 何が分かるか |
| --- | --- |
| `demo/models.py` | クラスの書き方 / DBの表の作り方 |
| `demo/api.py` | 関数 / 辞書 / if / try-except / デコレータ |
| `demo/views.py` | 戻り値を2つ返す書き方 / HTMLに値を渡す方法 |
| `main/models.py` | 自分たちの表を書く場所（見本がコメントで入っています） |

### 最初の練習メニュー

1. `demo/api.py` の `list_todos` を読んで、**何をしているか日本語で説明できるようにする**
2. `main/models.py` のコメントを参考に、表を1つ作ってみる
3. `makemigrations` → `migrate` を打って、**DBeaverで実際に表ができたのを見る**
4. `main/views.py` に画面を返す関数を1つ書いて、`main/urls.py` に1行足す

**3番が特に大事です。** 自分の書いたコードがDBの表になって現れるのを一度見ておくと、
その後のモデルの話が全部すっと入ります。DBはもう全員触れるので、ここは強みです。

---

## おまけ:Pythonを触るときの心構え

Javaは「間違いを先に全部潰してから動かす」言語でした。
Pythonは**「とりあえず動かして、間違ったらその場で教えてもらう」**言語です。

だから、**書いたらすぐ動かしてください。** 完璧に書き上げてから実行しようとすると、
エラーが10個まとめて出てきて、どこが原因か分からなくなります。

1行足したら動かす。表示されたら次を足す。この繰り返しが一番速いです。
このテンプレートは保存するだけで自動で反映されるので、それがやりやすくなっています。
