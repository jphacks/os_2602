# アーカイブ（元に戻す用の控え）

ここは画面からは読み込まれない。元に戻したいときに、ファイルを上書きコピーして使う。

## badge_2026-10-18_before-pattern-v2.js

砂の模様（クラドニ図形）の決め方を変える前の `static/js/badge.js`（コミット f4c93e9 の時点）。

- 変える前：一番強い帯から上位3つを選び、帯ごとに決まった振動の型（16種類）を重ねる
- 変えた後：低音の偏りを差し引き、音の形の特徴（重心・広がりなど）から型を連続的に決める

戻し方（どちらか）

    cp tools/archive/badge_2026-10-18_before-pattern-v2.js static/js/badge.js
    git checkout f4c93e9 -- static/js/badge.js
