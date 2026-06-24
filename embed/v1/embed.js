/**
 * Budget Lab Charts — embed loader
 * @version 1.0.0
 * Snippet: <script src=".../budget-lab-charts/embed/v1/embed.js" data-chart="<collection>/<chart>"></script>
 * Auto-sizes the chart iframe to content height via iframe-resizer v4 (MIT, vendored alongside).
 * Mirrors the budget-lab-interactives embed loader; the only differences are that charts are
 * addressed by their durable id (data-chart = "<collection-slug>/<chart-folder>") and served at
 * the Pages root, and that data-eyebrow controls the figure-number eyebrow.
 */
(function () {
  'use strict';

  var me = document.currentScript;
  if (!me) return;

  var chart = me.getAttribute('data-chart');
  if (!chart) {
    console.error('[TBL charts embed] data-chart attribute is required (e.g. "atus-childcare/childcare-by-activity").');
    return;
  }

  // Loader lives at <base>/embed/v1/embed.js with iframe-resizer pinned alongside it. Charts are
  // served at the site root <base>/<collection>/<chart>/ — so ../../ from the loader is <base>.
  var srcUrl     = new URL(me.src, window.location.href);
  var loaderBase = srcUrl.origin + srcUrl.pathname.replace(/\/embed\.js$/, '/');
  var siteBase   = new URL('../../', loaderBase).href;

  var src = siteBase + chart.replace(/^\/+|\/+$/g, '') + '/';
  if (me.getAttribute('data-eyebrow') === 'off') src += '?eyebrow=off';

  // Wrapper takes flow space; iframe is position:absolute inside it. This defeats host CSS that
  // targets <iframe> directly (e.g. Drupal's responsive-embed modules) which would otherwise take
  // the iframe out of flow. Initial height is small so iframe-resizer grows the wrapper to actual
  // content height rather than shrinking from a too-tall default.
  var initialHeight = (me.getAttribute('data-height') || '100') + 'px';
  var wrapper = document.createElement('div');
  wrapper.className     = 'tbl-embed-wrapper';
  wrapper.style.cssText = 'position:relative !important;display:block !important;width:100% !important;max-width:100% !important;height:' + initialHeight + ';';

  var iframe = document.createElement('iframe');
  iframe.id        = 'tbl-chart-' + chart.replace(/[^a-z0-9]+/gi, '-') + '-' + Math.random().toString(36).slice(2, 8);
  iframe.src       = src;
  iframe.scrolling = 'no';
  iframe.loading   = 'lazy';
  iframe.style.cssText = 'position:absolute !important;top:0 !important;left:0 !important;width:100% !important;height:100% !important;border:0 !important;display:block !important;';

  // Accessible title: an explicit data-title wins; otherwise derive it from the published catalog
  // (eyebrow + title) so authors only need data-chart. Falls back to the id until/if that resolves.
  var explicitTitle = me.getAttribute('data-title');
  iframe.title = explicitTitle || chart;
  if (!explicitTitle && window.fetch) {
    fetch(siteBase + 'catalog/index.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cat) {
        if (!Array.isArray(cat)) return;
        var hit = null;
        for (var i = 0; i < cat.length; i++) { if (cat[i] && cat[i].id === chart) { hit = cat[i]; break; } }
        if (hit && hit.title) iframe.title = (hit.eyebrow ? hit.eyebrow + ' — ' : '') + hit.title;
      })
      .catch(function () {});
  }

  wrapper.appendChild(iframe);
  me.parentNode.insertBefore(wrapper, me);

  // Strip width-dependent height from host-CMS wrapper classes (e.g., Drupal's
  // paragraph-embed-code applies padding-bottom for responsive-embed aspect-ratio enforcement).
  // Extendable per-embed via data-strip-host-classes (comma-separated).
  var stripClasses = (me.getAttribute('data-strip-host-classes') ||
                      'paragraph-embed-code').split(',').map(function (s) { return s.trim(); });
  var p = wrapper.parentElement;
  while (p && p !== document.body) {
    for (var i = 0; i < stripClasses.length; i++) {
      if (p.classList && p.classList.contains(stripClasses[i])) {
        p.style.setProperty('padding-bottom', '0', 'important');
        p.style.setProperty('min-height', '0', 'important');
        p.style.setProperty('height', 'auto', 'important');
        p.style.setProperty('aspect-ratio', 'auto', 'important');
      }
    }
    p = p.parentElement;
  }

  function init() {
    window.iFrameResize({
      log: me.hasAttribute('data-log'),
      checkOrigin: false,
      // bodyOffset measures body.offsetHeight directly. Other methods (bodyScroll, lowestElement)
      // can ratchet up to the iframe viewport size and fail to shrink when content shrinks.
      heightCalculationMethod: 'bodyOffset',
      tolerance: 4,
      scrolling: false,
      onResized: function (data) { wrapper.style.height = data.height + 'px'; },
    }, '#' + iframe.id);

    // iframe-resizer's content script doesn't listen for window resize. When the host page reflows,
    // content inside the iframe may also reflow via CSS (panes stacking, label wrapping) without
    // firing a DOM mutation, so iframe-resizer wouldn't re-measure. Hook host resize, debounced.
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (iframe.iFrameResizer && iframe.iFrameResizer.resize) {
          iframe.iFrameResizer.resize();
        }
      }, 150);
    });
  }

  if (window.iFrameResize) {
    init();
  } else {
    var s = document.createElement('script');
    s.src = loaderBase + 'iframeResizer.min.js';
    s.onload  = init;
    s.onerror = function () { console.error('[TBL charts embed] failed to load iframe-resizer.'); };
    document.head.appendChild(s);
  }
}());
