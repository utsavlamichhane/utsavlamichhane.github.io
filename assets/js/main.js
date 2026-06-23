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

  // Subtle scroll-reveal — professional, respects reduced-motion. Progressive
  // enhancement: the .reveal class is only added when JS + IO are available,
  // so content is always visible without JS.
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce && "IntersectionObserver" in window) {
    var sel = ".card, .step, .skilltile, .subtab, .figure, .logo-banner, .sec-head, .chips, .linklist, .codebox";
    var els = Array.prototype.slice.call(document.querySelectorAll(sel));
    els.forEach(function (el) {
      el.classList.add("reveal");
      // gentle stagger within a shared parent (grids)
      var i = Array.prototype.indexOf.call(el.parentNode.children, el);
      el.style.transitionDelay = Math.min(i, 6) * 60 + "ms";
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (el) { io.observe(el); });
  }
})();
