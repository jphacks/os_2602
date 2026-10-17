/* ===========================================================================
   theme.js = ライト・ダークの切り替えボタン（全ページ共通。base.html で読み込む）

   ▼ 仕組み
     <html data-theme="light|dark"> を書き換えるだけ。色は app.css のパレットが切り替わる。
     選んだほうを localStorage に保存し、次に開いたときは base.html の <head> がそれを使う。
   =========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "dether-theme"; // base.html の <head> のスクリプトと同じ名前
  const THEME_COLOR = { light: "#f1e9d2", dark: "#243b35" }; // スマホの上のバーの色

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute(
        "aria-label",
        theme === "dark" ? "ライトモードに切り替える" : "ダークモードに切り替える"
      );
    });
  }

  apply(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      apply(next);
      // ★プライベートブラウズなどで保存できなくても、切り替え自体は効かせる
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {}
    });
  });
})();
