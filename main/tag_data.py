# =============================================================================
# tag_data.py = みんなで共有するタグの一覧
#
# ▼ タグを足すとき
#
#   下の TAGS に1つ足して commit するだけ。各自が python manage.py migrate を実行すると、
#   DBにまだ無いタグが入る（apps.py が migrate の後に sync_tags を呼ぶ）。
#
# ▼ 決まり
#
#   ・名前が同じタグがもうあれば、ヒント（hint）と説明（description）が空のときだけ埋める。
#     ほかの項目は何もしない。管理サイトで直した内容は上書きしない
#   ・ここから消しても、DBのタグは消えない（測定に付いているかもしれないため）。消すなら管理サイトから
#   ・名前を変えると、別のタグとして新しく入る（古い名前のタグは残る）
# =============================================================================

# 共通タグ（いつでも選べる）
#   name … 名前 / icon … 地図の丸いアイコンに出す1文字 / order … 表示順
# 季節タグ（毎年決まった期間だけ選べる）は、さらに次を書く
#   start / end … (月, 日, "時:分")。時刻を省くなら (月, 日)
#   period      … 季節タグ図鑑に出す期間の言葉（省くと月日から自動で作る）
# どちらのタグにも書ける（省いてよい）。マイページの「音の図鑑」に出る
#   hint … まだ出会っていないときのヒント（省くと期間から自動で作る）
#   description … 出会ったあとに読める説明 / rare … True で「レア！」の印
#   color … メダルの色。sage（セージ・省略時）/ moss（苔）/ ai（藍）/ shu（朱）/ yamabuki（山吹）
#           / fuji（藤）/ sakura（桜）/ sumi（墨）。見た目は static/css/badge.css の .m-tag-○○
TAGS = [

    {"name": "セミ", "icon": "蝉", "color": "yamabuki",
    "start": (6, 1, "00:00"), "end": (10, 16, "00:00"), "period": "季節",
    "hint": "夏に出逢える虫と言えば...",
    "description": "夏休みの朝、目覚ましより先に聞こえていた声。"
                   "土の中で何年も過ごし、地上で鳴けるのは数週間ほど。"
                   "近くの木で鳴くと、80dBをこえることもあります。"},

    {"name": "鉄道", "icon": "鉄", "color": "ai",
    "hint": "線路のそば、規則正しいリズムが近づいてくる。",
    "description": "ガタンゴトン、と遠ざかっていく音に、旅のはじまりを思い出す。"
                   "電車が通るときの高架下は、100dB近くになることもあります。"},

    {"name": "祭り", "icon": "祭", "color": "shu",
    "start": (1, 1, "00:00"), "end": (12, 31, "00:00"), "period": "季節",
    "hint": "ちょうちんの明かりと、お腹にひびく太鼓の音。",
    "description": "浴衣のすそを気にしながら歩いた、夜店の通り。"
                   "太鼓のすぐそばでは100dBをこえることもあるので、耳を近づけすぎないで。"},

    {"name": "交通", "icon": "交", "color": "sumi",
    "hint": "信号が青に変わると、いっせいに動き出す音。",
    "description": "いつもの帰り道に流れている、街の呼吸のような音。"
                   "大通りの交差点はおよそ70〜80dB。"
                   "車のクラクションは、すぐ前で110dBほどになります。"},

    {"name": "喧騒", "icon": "騒", "color": "fuji",
    "hint": "人の声が重なって、ひとつのざわめきになる場所。",
    "description": "誰かの笑い声も、店先の呼び込みも、まざり合えば街の音になる。"
                   "にぎやかな繁華街は、70〜80dBくらいです。"},

    {"name": "音楽フェス", "icon": "♬", "color": "sakura",
    "start": (1, 1, "00:00"), "end": (12, 31, "00:00"), "period": "季節",
    "hint": "空の下、スピーカーの前でみんなが跳ねている。",
    "description": "知らない人とも、同じ歌で揺れた夕暮れ。"
                   "スピーカーの前は100dBをこえることも。"
                   "長く聞くときは、ときどき離れて耳を休ませてね。"},

]



def sync_tags(sender, apps, **kwargs):
    """migrate の後に呼ばれる。TAGS のうち、DBにまだ無いタグを入れる"""
    from datetime import time

    Tag = apps.get_model("main", "Tag")

    def parse(when):
        if not when:
            return None, None, None
        month, day, *rest = when
        if not rest:
            return month, day, None
        hour, minute = map(int, rest[0].split(":"))
        return month, day, time(hour, minute)

    for t in TAGS:
        sm, sd, st = parse(t.get("start"))
        em, ed, et = parse(t.get("end"))
        tag, created = Tag.objects.get_or_create(
            name=t["name"],
            defaults={
                "icon": t.get("icon", ""),
                "tag_type": "seasonal" if t.get("start") else "common",
                "start_month": sm,
                "start_day": sd,
                "start_time": st,
                "end_month": em,
                "end_day": ed,
                "end_time": et,
                "period_text": t.get("period", ""),
                "sort_order": t.get("order", 0),
                "hint": t.get("hint", ""),
                "description": t.get("description", ""),
                "is_rare": t.get("rare", False),
                "medal_color": t.get("color", "sage"),
            },
        )
        if created:
            continue
        # もうあるタグは、ヒントと説明が空のときだけ埋める（管理サイトで書いた内容は上書きしない）
        filled = []
        for field in ("hint", "description"):
            if t.get(field) and not getattr(tag, field):
                setattr(tag, field, t[field])
                filled.append(field)
        if filled:
            tag.save(update_fields=filled)
