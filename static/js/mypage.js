/* ===========================================================================
   mypage.js = マイページ（mypage.html）の「集めたバッジ」の絞り込み

   ▼ 仕組み
     タブ（すべて／昼／夜）を押すと、その時間帯の行だけを出す。
     行の data-band が時間帯のID、data-count が個数（main/views.py の mypage() が入れている）。
     右上の「合計」も、出している行の個数の合計に変える。
   =========================================================================== */

(function () {
  "use strict";

  const tabs = document.querySelectorAll(".band-tabs__tab");
  const rows = document.querySelectorAll(".badge-list__row");
  const sum = document.getElementById("badge-sum");
  const empty = document.getElementById("badge-empty");
  if (!tabs.length || !rows.length) return; // バッジが1つも無いときは絞り込むものが無い

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const band = tab.dataset.band;
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));

      let total = 0;
      rows.forEach((row) => {
        const show = band === "all" || row.dataset.band === band;
        row.hidden = !show;
        if (show) total += Number(row.dataset.count);
      });
      sum.textContent = String(total);
      empty.hidden = total > 0;
    });
  });
})();
