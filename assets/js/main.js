/* Utsav Lamichhane — site interactions (vanilla JS) */
(function () {
  "use strict";

  // Mobile nav toggle
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      links.classList.toggle("show");
    });
  }

  // Dropdowns: hover on desktop (CSS), click/tap to expand on mobile + a11y
  document.querySelectorAll(".has-drop > .nav-trigger").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var parent = btn.parentElement;
      var isOpen = parent.classList.contains("open");
      document.querySelectorAll(".has-drop.open").forEach(function (p) { p.classList.remove("open"); });
      if (!isOpen) parent.classList.add("open");
    });
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".has-drop")) {
      document.querySelectorAll(".has-drop.open").forEach(function (p) { p.classList.remove("open"); });
    }
  });

  // Copy-to-clipboard buttons (data-copy holds the text)
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      navigator.clipboard.writeText(text).then(function () {
        var orig = btn.textContent;
        btn.textContent = "copied";
        setTimeout(function () { btn.textContent = orig; }, 1400);
      });
    });
  });

  // Footer year
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
