# =============================================================================
# views.py = ログイン・ログアウト・新規登録
#
# ▼ ★ここでも Django の「全部入り」が効いている
#
#   自分で書く必要がないもの:
#     ・ユーザーの表(User)         … 最初から用意されている
#     ・パスワードを戻せない形にする … create_user() が中でやってくれる
#     ・パスワードの照合            … authenticate() がやってくれる
#     ・ログイン状態の保持          … login() がやってくれる
#     ・成りすまし対策(CSRF)       … 設定済み。HTMLに1行書くだけ
#
#   このファイルに書いてあるのは「入力チェック」と「画面の行き先」だけ。
#
# ▼ Django側の受け取り方
#
#   GET  = 画面を見に来た  → HTMLを返す
#   POST = 入力を送ってきた → 中身を照合する
#   同じURLでも request.method で分岐する。
#
# ▼ messages.success("文字")
#
#   次に表示される画面に一度だけメッセージを出す仕組み。
#   表示場所は base.html に1か所だけ書いてある。
# =============================================================================

from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_http_methods

from accounts.loginlimit import (
    clear_failures,
    client_ip,
    lock_remaining,
    minutes_to_wait,
    record_failure,
    remaining_attempts,
)

# Djangoの User の、ユーザー名の最大文字数。
USERNAME_MAX_LENGTH = 150


def register(request):
    """新しいユーザーを作る。"""

    # request.user = 今アクセスしている人。Djangoが自動で用意する。
    if request.user.is_authenticated:
        return redirect("/")

    if request.method == "POST":
        # request.POST.get("username") の "username" は
        # HTML側の <input name="username"> と1対1で対応する。
        # ★ここがズレると値が届かない(つまずきの定番)。
        username = request.POST.get("username", "").strip()
        password = request.POST.get("password", "")
        password_confirm = request.POST.get("password_confirm", "")

        # 問題点をまとめて集めて最後に表示する。
        # 「1個直すと次のエラーが出る」を繰り返させないため。
        problems = []

        if not username:
            problems.append("ユーザー名を入力してください。")
        elif len(username) > USERNAME_MAX_LENGTH:
            problems.append(f"ユーザー名は{USERNAME_MAX_LENGTH}文字以内で入力してください。")
        elif User.objects.filter(username=username).exists():
            problems.append("そのユーザー名はすでに使われています。")

        if password != password_confirm:
            problems.append("パスワードが一致しません。")

        # ★Djangoが用意しているパスワードの強さチェック。
        #   「短すぎる」「よくあるパスワード」「数字だけ」を日本語で教えてくれる。
        #   自分で条件を書かなくてよい(設定は settings.py の
        #   AUTH_PASSWORD_VALIDATORS)。
        try:
            validate_password(password)
        except ValidationError as exc:
            problems.extend(exc.messages)

        if problems:
            for message in problems:
                messages.error(request, message)

            # username を渡すので、入力した名前は消えずに残る。
            return render(
                request,
                "register.html",
                {"title": "新規登録", "username": username},
            )

        # ★create_user() を使うこと。
        #   User(...) を直接作って save() すると、パスワードが
        #   そのままの文字で保存されてしまう。
        user = User.objects.create_user(username=username, password=password)

        login(request, user)
        messages.success(request, f"ようこそ、{user.username} さん!")
        return redirect("/")

    return render(request, "register.html", {"title": "新規登録"})


def login_view(request):
    """ユーザー名とパスワードを照合してログインさせる。"""

    if request.user.is_authenticated:
        return redirect("/")

    if request.method == "POST":
        username = request.POST.get("username", "").strip()
        password = request.POST.get("password", "")

        # ▼ ★何度も失敗している相手は、照合する前に追い返す
        #
        #   仕組みは accounts/loginlimit.py。
        #   パスワードを見る前に止めるのが要点。ここを照合の後ろに置くと、
        #   締め出し中でも1回ずつ試させてしまい、時間をかければ
        #   当てられる状態のままになる。
        ip = client_ip(request)

        remaining = lock_remaining(ip)
        if remaining is not None:
            messages.error(
                request,
                "ログインの失敗が続いたため、一時的に制限しています。"
                f"あと約{minutes_to_wait(remaining)}分お待ちください。",
            )
            # 429 = 「回数が多すぎる」を表す番号。
            return render(
                request,
                "login.html",
                {
                    "title": "ログイン",
                    "username": username,
                    "next": request.POST.get("next", ""),
                },
                status=429,
            )

        # authenticate = 名前とパスワードが正しければユーザーを返し、
        # 違えば None を返す。照合処理は自分で書かなくてよい。
        user = authenticate(request, username=username, password=password)

        # ★「ユーザー名が違います」と書かない理由
        #   どの名前が実在するかを攻撃者に教えてしまうため、あえてぼかす。
        if user is None:
            # 失敗を1回数える。5回目でこのアクセス元は15分締め出される。
            record_failure(ip)

            message = "ユーザー名またはパスワードが正しくありません。"
            status = 200

            # ★今の失敗で締め出しに達したかを、その場で確かめて伝える。
            #
            #   これが無いと、5回目は普通の「違います」だけが出て、
            #   次にもう一度押したときに初めて締め出しを知ることになる。
            #   利用者から見ると「急に入れなくなった」としか分からない。
            reached = lock_remaining(ip)
            if reached is not None:
                message = (
                    "ログインの失敗が続いたため、一時的に制限しました。"
                    f"あと約{minutes_to_wait(reached)}分お待ちください。"
                )
                status = 429
            else:
                # ★残り回数を出す理由は loginlimit.py の remaining_attempts に。
                #   残り2回以下になってから出す(最初から出すと不安にさせるだけ)。
                left = remaining_attempts(ip)
                if 0 < left <= 2:
                    message += f"(あと{left}回失敗すると、しばらくログインできなくなります)"

            messages.error(request, message)
            return render(
                request,
                "login.html",
                {
                    "title": "ログイン",
                    "username": username,
                    "next": request.POST.get("next", ""),
                },
                status=status,
            )

        # ★成功したら失敗の記録を消す。
        #   これが無いと、正しく入れた後も前の失敗が残り続け、
        #   次に1回打ち間違えただけで締め出される。
        clear_failures(ip)

        # login() がブラウザに「あなたは○番の人」というメモを持たせる。
        login(request, user)
        messages.success(request, "ログインしました。")

        # ログイン必須ページから飛ばされて来た人は元の場所に戻す。
        return redirect(_safe_next(request, request.POST.get("next", "")))

    return render(
        request,
        "login.html",
        {"title": "ログイン", "next": request.GET.get("next", "")},
    )


@require_http_methods(["POST"])
def logout_view(request):
    """ログアウトする。"""
    logout(request)
    messages.success(request, "ログアウトしました。")
    return redirect("/")


def _safe_next(request, target: str) -> str:
    """ログイン後の遷移先が安全か確かめる。

    ログイン画面のURLには /auth/login?next=/mypage のように戻り先が付く。
    この next を無条件に信じると、?next=https://偽サイト.com というリンクを
    配られてログイン直後に飛ばされる(オープンリダイレクト)。

    url_has_allowed_host_and_scheme = 「自分のサイト内か」を判定する
    Django標準の関数。自分で判定を書くと "//偽サイト.com" のような
    紛らわしい書き方を見落とすので、用意されているものを使う。
    """
    if target and url_has_allowed_host_and_scheme(
        url=target,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return target
    return "/"
