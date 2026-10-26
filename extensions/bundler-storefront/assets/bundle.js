/* global globalThis */
/* MobiBundler storefront block. Plain script (no build step); core helpers are exposed on
   globalThis.MobiBundle so they can be unit-tested. It never sends a price: the only thing submitted to the
   cart is variant ids and quantities, and the discount is applied by the Shopify Function at checkout. */
(function () {
  'use strict';
  if (globalThis.MobiBundle) return;

  /** Cart payload for /cart/add.js. `_mobi_bundle` is a grouping hint only; it is not used for pricing. */
  function buildCartPayload(bundle) {
    return {
      items: bundle.items.map(function (item) {
        return {
          id: Number(item.variantNumericId),
          quantity: item.quantity,
          properties: { _mobi_bundle: bundle.id },
        };
      }),
    };
  }

  function formatMoney(decimalString, currency, locale) {
    var n = Number(decimalString);
    try {
      return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency: currency }).format(n);
    } catch (e) {
      return decimalString + ' ' + currency;
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // textContent only: bundle data is never parsed as HTML
    return node;
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function sendEvent(proxy, bundleId, type, dedupeKey) {
    try {
      post(proxy + '/events', { bundleId: bundleId, type: type, dedupeKey: dedupeKey }).catch(function () {});
    } catch (e) {
      /* analytics must never affect shopping */
    }
  }

  function randomKey() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    return String(Date.now()) + Math.random().toString(36).slice(2, 12);
  }

  function viewKey(bundleId) {
    // One view per bundle per browser session per hour; the random token keeps visitors distinct.
    var hour = Math.floor(Date.now() / 3600000);
    var storageKey = 'mobi-view-' + bundleId + '-' + hour;
    try {
      if (sessionStorage.getItem(storageKey)) return null;
      var key = randomKey();
      sessionStorage.setItem(storageKey, key);
      return key;
    } catch (e) {
      return randomKey();
    }
  }

  function render(root, bundle) {
    var d = root.dataset;
    root.textContent = '';
    root.appendChild(el('h3', 'mobi-bundle__title', bundle.name));

    var list = el('ul', 'mobi-bundle__items');
    var allInStock = true;
    bundle.items.forEach(function (item, index) {
      if (index > 0) {
        var plus = el('li', 'mobi-bundle__plus', '+');
        plus.setAttribute('aria-hidden', 'true');
        list.appendChild(plus);
      }
      var li = el('li', 'mobi-bundle__item');
      var frame = el('div', 'mobi-bundle__frame');
      if (item.imageUrl) {
        var img = el('img', 'mobi-bundle__img');
        img.src = item.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        frame.appendChild(img);
      }
      if (item.quantity > 1) frame.appendChild(el('span', 'mobi-bundle__qty', '\u00d7' + item.quantity));
      li.appendChild(frame);
      li.appendChild(el('span', 'mobi-bundle__name', item.title));
      li.appendChild(el('span', 'mobi-bundle__item-price', formatMoney(item.price, bundle.currencyCode, d.locale)));
      if (!item.inStock) {
        allInStock = false;
        li.appendChild(el('span', 'mobi-bundle__badge', d.labelOutOfStock));
      }
      list.appendChild(li);
    });
    root.appendChild(list);

    var footer = el('div', 'mobi-bundle__footer');
    var prices = el('div', 'mobi-bundle__prices');
    if (bundle.discountMinor > 0) {
      prices.appendChild(el('s', 'mobi-bundle__was', formatMoney(bundle.subtotal, bundle.currencyCode, d.locale)));
    }
    prices.appendChild(el('span', 'mobi-bundle__now', formatMoney(bundle.total, bundle.currencyCode, d.locale)));
    if (bundle.showSavings && bundle.discountMinor > 0) {
      prices.appendChild(
        el('span', 'mobi-bundle__save', d.labelSavings + ' ' + formatMoney(bundle.discount, bundle.currencyCode, d.locale))
      );
    }
    footer.appendChild(prices);

    var button = el('button', 'mobi-bundle__button', bundle.buttonLabel || d.labelAdd);
    button.type = 'button';
    button.disabled = !allInStock;
    var message = el('p', 'mobi-bundle__message');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');

    button.addEventListener('click', function () {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      var original = button.textContent;
      button.textContent = d.labelAdding;
      message.className = 'mobi-bundle__message';
      message.textContent = '';
      post('/cart/add.js', buildCartPayload(bundle))
        .then(function (res) {
          if (res.ok) {
            sendEvent(d.proxy, bundle.id, 'add_to_cart', randomKey());
            window.location.href = '/cart';
            return;
          }
          return res.json().catch(function () { return {}; }).then(function (body) {
            message.className = 'mobi-bundle__message mobi-bundle__message--error';
            message.textContent = res.status === 422 ? d.labelSoldOut : body.description || d.labelError;
          });
        })
        .catch(function () {
          message.className = 'mobi-bundle__message mobi-bundle__message--error';
          message.textContent = d.labelError;
        })
        .then(function () {
          button.disabled = !allInStock;
          button.removeAttribute('aria-busy');
          button.textContent = original;
        });
    });
    footer.appendChild(button);
    root.appendChild(footer);
    root.appendChild(message);
  }

  function showStatus(root, text, isError) {
    root.textContent = '';
    var p = el('p', 'mobi-bundle__status' + (isError ? ' mobi-bundle__message--error' : ''), text);
    p.setAttribute('role', isError ? 'alert' : 'status');
    root.appendChild(p);
  }

  /** What to show when no bundle applies. null = show nothing (live storefront); text only in the theme editor. */
  function emptyMessage(data, designMode) {
    if (!designMode) return null;
    return data.bundleId || data.productId ? data.labelNoBundle : data.labelNoTarget;
  }

  function hideOrExplain(root) {
    // Genuine failures use showStatus(labelError). An unset/inactive bundle is expected: explain it in the
    // theme editor, and on the live storefront show nothing.
    var text = emptyMessage(root.dataset, !!(globalThis.Shopify && globalThis.Shopify.designMode));
    if (text) showStatus(root, text, false);
    else root.hidden = true;
  }

  /** An explicit Bundle ID always wins; otherwise ask for the bundle that contains the product being viewed. */
  function bundleQuery(data) {
    if (data.bundleId) return 'ids=' + encodeURIComponent(data.bundleId);
    if (data.productId) return 'product=' + encodeURIComponent(data.productId);
    return '';
  }

  function initBlock(root) {
    var proxy = root.dataset.proxy;
    var query = bundleQuery(root.dataset);
    if (!query) return hideOrExplain(root);
    fetch(proxy + '/bundles?' + query, { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('bad status');
        return res.json();
      })
      .then(function (data) {
        var bundle = data.bundles && data.bundles[0];
        if (!bundle) return hideOrExplain(root); // unknown, inactive, or another shop's bundle
        render(root, bundle);
        var key = viewKey(bundle.id);
        if (key) sendEvent(proxy, bundle.id, 'view', key);
      })
      .catch(function () {
        showStatus(root, root.dataset.labelError, true);
      });
  }

  function init() {
    document.querySelectorAll('.mobi-bundle').forEach(initBlock);
  }

  globalThis.MobiBundle = { buildCartPayload: buildCartPayload, formatMoney: formatMoney, init: init, emptyMessage: emptyMessage, bundleQuery: bundleQuery };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    document.addEventListener('shopify:section:load', init);
  }
})();
