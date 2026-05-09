
    (function() {
      var preconnectOrigins = ["https://cdn.shopify.com"];
      var scripts = ["/cdn/shopifycloud/checkout-web/assets/c1/polyfills.BGEdQoKJ.js","/cdn/shopifycloud/checkout-web/assets/c1/app.DoS_lZ4T.js","/cdn/shopifycloud/checkout-web/assets/c1/esnext-vendor.DxCcaam1.js","/cdn/shopifycloud/checkout-web/assets/c1/browser.DKtyEn8z.js","/cdn/shopifycloud/checkout-web/assets/c1/hooks-useShopPayProgressIntercepts.DUjE6mID.js","/cdn/shopifycloud/checkout-web/assets/c1/types-ModalOrigin.Mp1Eej8p.js","/cdn/shopifycloud/checkout-web/assets/c1/NotFound.DO1dmuJh.js","/cdn/shopifycloud/checkout-web/assets/c1/hooks-useReplaceShopPayInHistory.CiCypnYw.js","/cdn/shopifycloud/checkout-web/assets/c1/extensibility-shared.mIrrsXd7.js","/cdn/shopifycloud/checkout-web/assets/c1/consent-manager-shared.BWg5aHMf.js","/cdn/shopifycloud/checkout-web/assets/c1/helpers-setAddressErrors.CC8qh9Bp.js","/cdn/shopifycloud/checkout-web/assets/c1/FullScreenBackground.hgOeemn4.js","/cdn/shopifycloud/checkout-web/assets/c1/events-shared.DwS8o_M9.js","/cdn/shopifycloud/checkout-web/assets/c1/images-flag-icon.C_eXYJRt.js","/cdn/shopifycloud/checkout-web/assets/c1/images-payment-icon.D2Fpq5Mq.js","/cdn/shopifycloud/checkout-web/assets/c1/locale-fr.B0R9UJQk.js","/cdn/shopifycloud/checkout-web/assets/c1/page-OnePage.C_y2EEMu.js","/cdn/shopifycloud/checkout-web/assets/c1/MarketsProDisclaimer.CAtCp4gs.js","/cdn/shopifycloud/checkout-web/assets/c1/CrossBorderConsolidation.BxS76fLA.js","/cdn/shopifycloud/checkout-web/assets/c1/hooks-useSubscribeMessenger.DNMl9LTt.js","/cdn/shopifycloud/checkout-web/assets/c1/ImpressionEventCapture.B4GSHhOf.js","/cdn/shopifycloud/checkout-web/assets/c1/AmazonPayButton.BDmKEeX-.js","/cdn/shopifycloud/checkout-web/assets/c1/hooks-useSuppressShopPayModalOnLoad.BgqqeYyb.js","/cdn/shopifycloud/checkout-web/assets/c1/hooks-useForceShopPayUrl.Dbk0MurE.js","/cdn/shopifycloud/checkout-web/assets/c1/ShopPayLogo.erf6cmlx.js","/cdn/shopifycloud/checkout-web/assets/c1/ShippingGroupsSummaryLine.T45vhlqX.js","/cdn/shopifycloud/checkout-web/assets/c1/StackedMerchandisePreview.BjskAy4t.js","/cdn/shopifycloud/checkout-web/assets/c1/PickupPointCarrierLogo.pbwN7-GP.js","/cdn/shopifycloud/checkout-web/assets/c1/AutocompleteField-hooks.DE3xeuaZ.js","/cdn/shopifycloud/checkout-web/assets/c1/LocalizationExtensionField.D5fquNJ9.js","/cdn/shopifycloud/checkout-web/assets/c1/hooks-useUpdateCheckoutAddress.Cj2FX_ei.js","/cdn/shopifycloud/checkout-web/assets/c1/paypal-express-usePayPalPaymentErrorHandler.G2VJoBmi.js","/cdn/shopifycloud/checkout-web/assets/c1/RememberMeDescriptionText.CODVJksP.js","/cdn/shopifycloud/checkout-web/assets/c1/Section.BWnH9evY.js","/cdn/shopifycloud/checkout-web/assets/c1/ShopPayOptInDisclaimer.DBMt8Ux7.js","/cdn/shopifycloud/checkout-web/assets/c1/MobileOrderSummary.DTvlz5DR.js","/cdn/shopifycloud/checkout-web/assets/c1/OrderEditVaultedDelivery.Cj9f1tek.js","/cdn/shopifycloud/checkout-web/assets/c1/SeparatePaymentsNotice.D8rJHT34.js","/cdn/shopifycloud/checkout-web/assets/c1/hooks-useShopPayInstallmentsUkHoldoutExperiment.CLnN3NKc.js","/cdn/shopifycloud/checkout-web/assets/c1/Page.DTsYdOTO.js","/cdn/shopifycloud/checkout-web/assets/c1/shop-cash-constants.Bam2sZHy.js","/cdn/shopifycloud/checkout-web/assets/c1/PaymentErrorBanner.BmeNHyhC.js","/cdn/shopifycloud/checkout-web/assets/c1/hooks-useGeneralPaymentErrorMessage.cbf3AuLZ.js","/cdn/shopifycloud/checkout-web/assets/c1/NoAddressLocationFullDetour.CxkfkaOb.js","/cdn/shopifycloud/checkout-web/assets/c1/OffsitePaymentFailed.wN6r1aA7.js","/cdn/shopifycloud/checkout-web/assets/c1/PaymentButtons.CCrPZ-5i.js","/cdn/shopifycloud/checkout-web/assets/c1/StockProblems-StockProblemsLineItemList.oXFnnguF.js","/cdn/shopifycloud/checkout-web/assets/c1/DutyOptions.BzKcfWvb.js","/cdn/shopifycloud/checkout-web/assets/c1/ShipmentBreakdown.sEWLbOns.js","/cdn/shopifycloud/checkout-web/assets/c1/MerchandiseModal.cCx4Mfpo.js","/cdn/shopifycloud/checkout-web/assets/c1/extension-targets-shipping-options.ZATVh5w5.js","/cdn/shopifycloud/checkout-web/assets/c1/ShippingMethodSelector.P0zyNuyi.js","/cdn/shopifycloud/checkout-web/assets/c1/SubscriptionPriceBreakdown.xDrIjYIn.js","/cdn/shopifycloud/checkout-web/assets/c1/NoAddressLocation.Bh2KaJGo.js"];
      var styles = ["/cdn/shopifycloud/checkout-web/assets/c1/assets/app.CfAhKPz4.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/useShopPayProgressIntercepts._rd0li_4.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/FullScreenBackground.DHKLGmKh.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/shared.CEMlQpma.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/OnePage.BVsfwQv1.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/CrossBorderConsolidation.B9NnUP55.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/LocalizationExtensionField.KuEoN8Dx.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/MobileOrderSummary.Cko1fUoG.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/OrderEditVaultedDelivery.CSQKPDv7.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/usePayPalPaymentErrorHandler.1xZZnAMV.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/Page.BYM12A8B.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/AmazonPayButton.uqpm88mq.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/Section.CU18S7Ap.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/useSubscribeMessenger.BrcQzLuH.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/DutyOptions.LcqrKXE1.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/PickupPointCarrierLogo.cbVP6Hp_.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/NoAddressLocationFullDetour.D14orovx.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/OffsitePaymentFailed.BxwwfmsJ.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/ShippingMethodSelector.B0hio2RO.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/SubscriptionPriceBreakdown.BSemv9tH.css","/cdn/shopifycloud/checkout-web/assets/c1/assets/StackedMerchandisePreview.D6OuIVjc.css"];
      var fontPreconnectUrls = [];
      var fontPrefetchUrls = [];
      var imgPrefetchUrls = [];

      function preconnect(url, callback) {
        var link = document.createElement('link');
        link.rel = 'dns-prefetch preconnect';
        link.href = url;
        link.crossOrigin = '';
        link.onload = link.onerror = callback;
        document.head.appendChild(link);
      }

      function preconnectAssets() {
        var resources = preconnectOrigins.concat(fontPreconnectUrls);
        var index = 0;
        (function next() {
          var res = resources[index++];
          if (res) preconnect(res, next);
        })();
      }

      function prefetch(url, as, callback) {
        var link = document.createElement('link');
        if (link.relList.supports('prefetch')) {
          link.rel = 'prefetch';
          link.fetchPriority = 'low';
          link.as = as;
          if (as === 'font') link.type = 'font/woff2';
          link.href = url;
          link.crossOrigin = '';
          link.onload = link.onerror = callback;
          document.head.appendChild(link);
        } else {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.onloadend = callback;
          xhr.send();
        }
      }

      function prefetchAssets() {
        var resources = [].concat(
          scripts.map(function(url) { return [url, 'script']; }),
          styles.map(function(url) { return [url, 'style']; }),
          fontPrefetchUrls.map(function(url) { return [url, 'font']; }),
          imgPrefetchUrls.map(function(url) { return [url, 'image']; })
        );
        var index = 0;
        function run() {
          var res = resources[index++];
          if (res) prefetch(res[0], res[1], next);
        }
        var next = (self.requestIdleCallback || setTimeout).bind(self, run);
        next();
      }

      function onLoaded() {
        try {
          if (parseFloat(navigator.connection.effectiveType) > 2 && !navigator.connection.saveData) {
            preconnectAssets();
            prefetchAssets();
          }
        } catch (e) {}
      }

      if (document.readyState === 'complete') {
        onLoaded();
      } else {
        addEventListener('load', onLoaded);
      }
    })();
  