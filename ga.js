// Google Analytics 4 (GA4) — turnamenpadel.com
// Loaded once per page via <script defer src="/ga.js"></script>.
// Measurement ID lives here only, so it stays in sync across all pages.
(function () {
  var ID = "G-XM9T7N3N47";
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", ID);
})();
