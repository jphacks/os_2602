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
#   ・名前が同じタグがもうあれば何もしない。管理サイトで直した内容は上書きしない
#   ・ここから消しても、DBのタグは消えない（測定に付いているかもしれないため）。消すなら管理サイトから
#   ・名前を変えると、別のタグとして新しく入る（古い名前のタグは残る）
# =============================================================================

# 共通タグ（いつでも選べる）
#   name … 名前 / icon … 地図の丸いアイコンに出す1文字 / order … 表示順
# 季節タグ（毎年決まった期間だけ選べる）は、さらに次を書く
#   start / end … (月, 日, "時:分")。時刻を省くなら (月, 日)
#   period      … 季節タグ図鑑に出す期間の言葉（省くと月日から自動で作る）
TAGS = [
    {"name": "セミ", "icon": "蝉", "start": (6, 1, "00:00"), "end": (11, 1, "00:00"), "period": "季節"},
    {"name": "鉄道", "icon": "鉄"},
    {"name": "祭り", "icon": "祭", "start": (1, 1, "00:00"), "end": (12, 31, "00:00"), "period": "季節"},
    {"name": "交通", "icon": "交"},
    {"name": "暗騒", "icon": "暗"},
    {"name": "音楽フェス", "icon": "音", "start": (1, 1, "00:00"), "end": (12, 31, "00:00"), "period": "季節"}
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
        Tag.objects.get_or_create(
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
            },
        )
