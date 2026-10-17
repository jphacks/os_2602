#!/usr/bin/env python
# =============================================================================
# strip_comments.py = このリポジトリのコメントを一括で消す道具
#
# チーム開発時は使用非推奨とします。
# チーム開発で使用する際は必ず最初に誰か一人がcloneしたときに実行し、その直後に
# 再度commit/pushするようにしてください。
#
#   ▼ 何のためのもの?
#     このテンプレートは「読んで覚える」ことを狙って解説を厚く書いてある。
#     一通り分かった人には、その解説がじゃまになる。
#     そういう人が、1コマンドで解説だけを消せるようにしたもの。
#     docs/ の手順書は消さないので、忘れたら後から読み返せる。
#
#   ▼ 使い方
#
#       docker compose exec web python tools/strip_comments.py --dry-run
#           何行消えるか数えるだけ。ファイルは1文字も変えない。まずこれ。
#
#       docker compose exec web python tools/strip_comments.py
#           実際に消す。消す前に tools/.comment_backup/ に写しを取る。
#
#       docker compose exec web python tools/strip_comments.py --restore
#           写しから元に戻す。
#
#   ▼ 消さないもの
#       ・docs/ の手順書、README、LICENSE
#       ・.env.example(項目の説明が消えたら見本の意味が無くなる)
#       ・docstring(関数の先頭の説明文。VSCodeの説明表示に使われる)
#       ・道具としてのコメント(# noqa: F401 など。消すと ruff が怒る)
#       ・このファイル自身
#
#   ▼ なぜ単純な検索置換にしないか
#     「# から行末まで消す」だけだと、消してはいけないものまで消える。
#         static/css/style.css の #f7f8fb    … 色の指定
#         compose.yml の値の中の #           … パスワードなどに入りうる
#         static/js/main.js の https:// の // … ただのURL
#     なので、言語ごとに正しい読み方をさせている。
#     Python は標準の tokenize に読ませているので、文字列の中の # は
#     そもそもコメントとして出てこない。
# =============================================================================
"""コメントを一括で消す(開発中の個人用の道具)。"""

import argparse
import io
import re
import shutil
import subprocess
import sys
import tokenize
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SELF = Path(__file__).resolve()
BACKUP_DIR = REPO_ROOT / "tools" / ".comment_backup"

# -----------------------------------------------------------------------------
# 1. どのファイルを対象にするか
# -----------------------------------------------------------------------------

# 中に入らないフォルダ。
SKIP_DIRS = {
    ".git",
    ".ruff_cache",
    ".pytest_cache",
    ".mypy_cache",
    "__pycache__",
    ".venv",
    "venv",
    "node_modules",
    "staticfiles",
    "media",
    "docs",
}

# 名前で除外するファイル。
SKIP_NAMES = {"uv.lock", "LICENSE"}

# 拡張子 → 読み方の対応表。ここに無い拡張子は触らない。
BY_SUFFIX = {
    ".py": "python",
    ".html": "template",
    ".css": "css",
    ".js": "js",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "hash",
    ".conf": "hash",
    ".json": "jsonc",
}

# 拡張子が無いファイルは名前で判断する。
BY_NAME = {"Dockerfile": "hash"}

# ★消してはいけないコメント。
#   人間向けの説明ではなく、道具への指示になっているもの。
#   例: # noqa: F401 を消すと「使っていない import」と判定されて ruff が止まる。
KEEP = re.compile(
    r"""
      ^!                                    # #!/usr/bin/env … と /*! ライセンス表記
    | ^syntax=                              # Dockerfile 先頭の指示
    | ^escape=
    | -\*-\s*coding                         # 文字コードの宣言
    | noqa
    | type:\s*ignore
    | (pyright|mypy|ruff|isort|pragma|fmt|flake8):
    | (eslint|prettier|stylelint)
    | @ts-
    | sourceMappingURL
    """,
    re.VERBOSE | re.IGNORECASE,
)


def is_target(path: Path) -> str | None:
    """このファイルを処理するなら読み方の名前を、しないなら None を返す。"""
    if path.resolve() == SELF:
        return None
    if path.name in SKIP_NAMES:
        return None
    if path.name.startswith(".env"):
        return None
    try:
        parts = path.relative_to(REPO_ROOT).parts
    except ValueError:
        return None
    for part in parts[:-1]:
        if part in SKIP_DIRS:
            return None
    # 素のJSONにコメントは書けない。書けるのは .vscode/ の設定だけ。
    if path.suffix == ".json" and path.parent.name != ".vscode":
        return None
    return BY_SUFFIX.get(path.suffix) or BY_NAME.get(path.name)


def collect(bases: list[Path]) -> list[Path]:
    """対象ファイルを集めて、パス順に並べて返す。"""
    found: set[Path] = set()
    for base in bases:
        candidates = sorted(base.rglob("*")) if base.is_dir() else [base]
        for path in candidates:
            if path.is_file() and is_target(path):
                found.add(path)
    return sorted(found)


# -----------------------------------------------------------------------------
# 2. コメントの居場所を探す係(言語ごと)
#
#    どの係も「消す範囲」を (開始位置, 終了位置) の一覧で返すだけにしてある。
#    実際に消す作業は 3. の apply_spans() が一手に引き受ける。
#    こうしておくと、言語が増えても消し方の作法がぶれない。
# -----------------------------------------------------------------------------

Span = tuple[int, int]


class Unreadable(Exception):
    """そのファイルとして読めなかった(壊すくらいなら飛ばす)。"""


def comment_body(raw: str) -> str:
    """コメントの記号(# や /* */)を外して、中身の文だけにする。"""
    text = raw.strip()
    for open_mark, close_mark in (("/*", "*/"), ("<!--", "-->"), ("{#", "#}")):
        if text.startswith(open_mark):
            text = text[len(open_mark) :]
            if text.endswith(close_mark):
                text = text[: -len(close_mark)]
            return text.strip()
    if text.startswith("//"):
        return text[2:].strip()
    if text.startswith("#"):
        return text.lstrip("#").strip()
    return text


def keep(raw: str) -> bool:
    return bool(KEEP.search(comment_body(raw)))


# --- Python ------------------------------------------------------------------


def scan_python(text: str) -> list[Span]:
    """標準の tokenize に読ませる。文字列の中の # はコメントとして出てこない。"""
    line_head = [0]
    for line in text.splitlines(keepends=True):
        line_head.append(line_head[-1] + len(line))

    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError) as err:
        raise Unreadable(f"Pythonとして読めません: {err}") from err

    spans = []
    for tok in tokens:
        if tok.type != tokenize.COMMENT or keep(tok.string):
            continue
        start = line_head[tok.start[0] - 1] + tok.start[1]
        end = line_head[tok.end[0] - 1] + tok.end[1]
        spans.append((start, end))
    return spans


# --- C系(JS / CSS / .vscode の設定) ------------------------------------------

# 直前がこの記号なら、次の / は割り算ではなく正規表現の始まり。
REGEX_AFTER_SYMBOL = set("(,=:[!&|?{};+-*%~^<>") | {""}
REGEX_AFTER_WORD = {
    "return",
    "typeof",
    "case",
    "in",
    "of",
    "new",
    "delete",
    "void",
    "yield",
    "await",
}
LAST_WORD = re.compile(r"[A-Za-z_$]+$")


def _skip_string(text: str, i: int, quote: str) -> int:
    j = i + 1
    while j < len(text):
        char = text[j]
        if char == "\\":
            j += 2
            continue
        if char == quote:
            return j + 1
        # 閉じ忘れがあっても行末で打ち切る(残り全部を文字列と誤解しないため)。
        if char == "\n" and quote != "`":
            return j
        j += 1
    return len(text)


def _skip_regex(text: str, i: int) -> int:
    j, in_class = i + 1, False
    while j < len(text):
        char = text[j]
        if char == "\\":
            j += 2
            continue
        if char == "\n":
            return i + 1  # 正規表現ではなかった。割り算として読み直す。
        if char == "[":
            in_class = True
        elif char == "]":
            in_class = False
        elif char == "/" and not in_class:
            j += 1
            while j < len(text) and text[j].isalpha():
                j += 1
            return j
        j += 1
    return i + 1


def scan_cstyle(text: str, *, line_comment: bool, regex: bool, backtick: bool) -> list[Span]:
    """/* */ と(言語によっては)// を探す。

    ★CSSには // のコメントが無い。line_comment=False にしておかないと
      url(http://...) の // から先が消える。
    """
    spans: list[Span] = []
    i, size = 0, len(text)
    prev = ""  # 直前の、空白でない1文字
    while i < size:
        pair = text[i : i + 2]
        if pair == "/*":
            end = text.find("*/", i + 2)
            end = size if end < 0 else end + 2
            if not keep(text[i:end]):
                spans.append((i, end))
            i, prev = end, "/"
            continue
        if line_comment and pair == "//":
            end = text.find("\n", i)
            end = size if end < 0 else end
            if not keep(text[i:end]):
                spans.append((i, end))
            i = end
            continue
        char = text[i]
        if char in "\"'" or (backtick and char == "`"):
            i, prev = _skip_string(text, i, char), char
            continue
        if regex and char == "/":
            word = LAST_WORD.search(text[:i].rstrip())
            if prev in REGEX_AFTER_SYMBOL or (word and word.group() in REGEX_AFTER_WORD):
                i, prev = _skip_regex(text, i), "/"
                continue
        if not char.isspace():
            prev = char
        i += 1
    return spans


# --- # で始まるもの(YAML / TOML / Dockerfile / nginx.conf) --------------------

# YAMLの「まとめ書き」(command: > のような書き方)の始まり。
BLOCK_SCALAR = re.compile(r":\s*[|>][-+0-9]*\s*$")


def _hash_at(line: str, *, yaml: bool) -> int | None:
    """その行でコメントが始まる位置。無ければ None。"""
    quote, i = None, 0
    while i < len(line):
        char = line[i]
        if quote:
            if char == "\\" and quote == '"':
                i += 2
                continue
            if char == quote:
                quote = None
            i += 1
            continue
        if char in "\"'":
            quote = char
            i += 1
            continue
        if char == "#":
            # ★YAMLでは、前が空白のときだけコメント。
            #   image: mysql:8.4 の後ろに #tag と続けても、それは値の一部。
            if yaml and i > 0 and line[i - 1] not in " \t":
                i += 1
                continue
            return i
        i += 1
    return None


def scan_hash(text: str, *, yaml: bool) -> list[Span]:
    spans: list[Span] = []
    pos = 0
    block_indent: int | None = None
    for raw in text.splitlines(keepends=True):
        line = raw.rstrip("\n")
        indent = len(line) - len(line.lstrip())
        if block_indent is not None:
            # まとめ書きの中身。ここに書いてある # はただの文字。
            if not line.strip() or indent > block_indent:
                pos += len(raw)
                continue
            block_indent = None
        at = _hash_at(line, yaml=yaml)
        if at is not None:
            if keep(line[at:]):
                at = None
            else:
                spans.append((pos + at, pos + len(line)))
        if yaml and BLOCK_SCALAR.search(line if at is None else line[:at]):
            block_indent = indent
        pos += len(raw)
    return spans


# --- テンプレート(Djangoの .html) --------------------------------------------

TAG_COMMENT = re.compile(r"\{%-?\s*comment\b[^%]*?-?%\}")
TAG_ENDCOMMENT = re.compile(r"\{%-?\s*endcomment\s*-?%\}")
TAG_SCRIPT = re.compile(r"<script\b[^>]*>", re.IGNORECASE)
TAG_STYLE = re.compile(r"<style\b[^>]*>", re.IGNORECASE)


def scan_template(text: str) -> list[Span]:
    """{% comment %} / {# #} / <!-- --> を消す。

    <script> <style> の中身はそれぞれの係に任せ、{{ }} と {% %} は
    中を見ずに読み飛ばす(この中に出てくる # や // はコメントではない)。
    """
    spans: list[Span] = []
    lowered = text.lower()
    i, size = 0, len(text)
    while i < size:
        if text.startswith("{#", i):
            end = text.find("#}", i + 2)
            end = size if end < 0 else end + 2
            if not keep(text[i:end]):
                spans.append((i, end))
            i = end
            continue

        opened = TAG_COMMENT.match(text, i)
        if opened:
            closed = TAG_ENDCOMMENT.search(text, opened.end())
            end = closed.end() if closed else size
            spans.append((i, end))
            i = end
            continue

        if text.startswith("<!--", i):
            end = text.find("-->", i + 4)
            end = size if end < 0 else end + 3
            # <!--[if IE]> のたぐいは命令なので残す。
            if not text.startswith("<!--[", i) and not keep(text[i:end]):
                spans.append((i, end))
            i = end
            continue

        opened = TAG_SCRIPT.match(text, i)
        if opened:
            end = lowered.find("</script", opened.end())
            end = size if end < 0 else end
            base = opened.end()
            inner = scan_cstyle(text[base:end], line_comment=True, regex=True, backtick=True)
            spans += [(base + a, base + b) for a, b in inner]
            i = end
            continue

        opened = TAG_STYLE.match(text, i)
        if opened:
            end = lowered.find("</style", opened.end())
            end = size if end < 0 else end
            base = opened.end()
            inner = scan_cstyle(text[base:end], line_comment=False, regex=False, backtick=False)
            spans += [(base + a, base + b) for a, b in inner]
            i = end
            continue

        for open_mark, close_mark in (("{{", "}}"), ("{%", "%}")):
            if text.startswith(open_mark, i):
                end = text.find(close_mark, i + 2)
                i = size if end < 0 else end + 2
                break
        else:
            i += 1
    return spans


SCANNERS = {
    "python": scan_python,
    "template": scan_template,
    "css": lambda t: scan_cstyle(t, line_comment=False, regex=False, backtick=False),
    "js": lambda t: scan_cstyle(t, line_comment=True, regex=True, backtick=True),
    "jsonc": lambda t: scan_cstyle(t, line_comment=True, regex=False, backtick=False),
    "yaml": lambda t: scan_hash(t, yaml=True),
    "hash": lambda t: scan_hash(t, yaml=False),
}


# -----------------------------------------------------------------------------
# 3. 実際に消す係
#
#    ★消したあとの空行の始末がいちばん大事。
#      コメントだけの行は行ごと消す。行の後ろに付いていたコメントは、
#      その部分だけ消して行は残す。消した結果 空行が2つ並んでしまう
#      ところだけ1つに詰める(関係ない場所の空行は触らない)。
# -----------------------------------------------------------------------------

DROPPED = object()


def apply_spans(text: str, spans: list[Span]) -> tuple[str, int]:
    """消す範囲を実際に消して、(消したあとの中身, 消えた行数) を返す。"""
    if not spans:
        return text, 0

    erased = bytearray(len(text))
    for start, end in spans:
        for k in range(start, min(end, len(text))):
            erased[k] = 1

    lines: list[object] = []
    pos = 0
    for raw in text.splitlines(keepends=True):
        end = pos + len(raw)
        if any(erased[pos:end]):
            kept = "".join(char for k, char in enumerate(raw, start=pos) if not erased[k])
            lines.append(DROPPED if not kept.strip() else kept.rstrip() + "\n")
        else:
            lines.append(raw if raw.endswith("\n") else raw + "\n")
        pos = end

    out: list[str] = []
    removed = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        if line is not DROPPED:
            out.append(line)  # type: ignore[arg-type]
            i += 1
            continue
        j = i
        while j < len(lines) and lines[j] is DROPPED:
            j += 1
        removed += j - i
        before_blank = bool(out) and not out[-1].strip()
        after_blank = j < len(lines) and not lines[j].strip()  # type: ignore[union-attr]
        if before_blank and after_blank:
            j += 1  # 前も後ろも空行になってしまう → 片方だけ残す
        i = j

    while out and not out[0].strip():
        out.pop(0)
    while out and not out[-1].strip():
        out.pop()
    return "".join(out), removed


def strip_file(path: Path, kind: str) -> tuple[str, str, int]:
    """(元の中身, 消したあとの中身, 消えた行数) を返す。"""
    text = path.read_text(encoding="utf-8")
    if not text.endswith("\n"):
        text += "\n"
    new_text, removed = apply_spans(text, SCANNERS[kind](text))
    return text, new_text, removed


# -----------------------------------------------------------------------------
# 4. 安全装置と入口
# -----------------------------------------------------------------------------


def git_dirty() -> bool | None:
    """未コミットの変更があるか。gitが使えない場所なら None。"""
    try:
        done = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return bool(done.stdout.strip())


def restore() -> int:
    if not BACKUP_DIR.exists():
        print("写しがありません(まだ消していないか、既に戻したあとです)。")
        return 1
    count = 0
    for saved in sorted(BACKUP_DIR.rglob("*")):
        if not saved.is_file():
            continue
        target = REPO_ROOT / saved.relative_to(BACKUP_DIR)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(saved, target)
        count += 1
    shutil.rmtree(BACKUP_DIR)
    print(f"{count} 個のファイルを元に戻しました。")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="このリポジトリのコメントを一括で消す(手元だけ。commitしないこと)",
    )
    parser.add_argument("paths", nargs="*", help="対象(省略するとリポジトリ全体)")
    parser.add_argument("--dry-run", action="store_true", help="数えるだけで書き換えない")
    parser.add_argument("--restore", action="store_true", help="写しから元に戻す")
    parser.add_argument("--force", action="store_true", help="未コミットの変更があっても実行する")
    args = parser.parse_args(argv)

    if args.restore:
        return restore()

    if not args.dry_run and BACKUP_DIR.exists():
        print("既に消したあとのようです(tools/.comment_backup/ が残っています)。")
        print("このまま消すと、写しが「消したあとの中身」で上書きされて戻せなくなります。")
        print("先に --restore で戻してください。")
        return 1

    if not args.dry_run and not args.force and git_dirty():
        print("未コミットの変更があります。")
        print("この道具は全ファイルを書き換えるので、あなたの作業と混ざって")
        print("見分けがつかなくなります。先にコミットするか、--force を付けてください。")
        return 1

    bases = [Path(p).resolve() for p in args.paths] or [REPO_ROOT]
    files = collect(bases)
    if not files:
        print("対象のファイルがありませんでした。")
        return 1

    changed: list[tuple[Path, int]] = []
    total = 0
    for path in files:
        kind = is_target(path)
        if kind is None:
            continue
        try:
            old, new, removed = strip_file(path, kind)
        except (Unreadable, UnicodeDecodeError) as err:
            print(f"  skip  {path.relative_to(REPO_ROOT)}  ({err})")
            continue
        if new == old:
            continue
        changed.append((path, removed))
        total += removed
        if not args.dry_run:
            saved = BACKUP_DIR / path.relative_to(REPO_ROOT)
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
            path.write_text(new, encoding="utf-8", newline="\n")

    width = max((len(str(p.relative_to(REPO_ROOT))) for p, _ in changed), default=0)
    for path, removed in changed:
        print(f"  {str(path.relative_to(REPO_ROOT)):<{width}}  -{removed} 行")

    tail = "消えます" if args.dry_run else "消しました"
    print(f"\n{len(changed)} ファイル / {total} 行 {tail}")
    if args.dry_run:
        print("実際に消すには --dry-run を外してください。")
    else:
        print("元に戻す: python tools/strip_comments.py --restore")
        print("★この状態で commit / push しないこと(全ファイルが差分になります)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
