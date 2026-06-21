import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Banner, Layout, Page } from "@shopify/polaris";

/**
 * Keeps the app's original embedded-app guard while App Bridge is loaded from
 * Shopify's CDN in index.html.
 */
export function AppBridgeProvider({ children }) {
  const location = useLocation();

  // The host may be present initially, but later removed by navigation.
  // By caching this in state, we ensure that the host is never lost.
  const [host] = useState(() => {
    const resolvedHost =
      new URLSearchParams(location.search).get("host") ||
      window.__SHOPIFY_DEV_HOST;

    window.__SHOPIFY_DEV_HOST = resolvedHost;
    return resolvedHost;
  });

  if (!host) {
    return (
      <Page narrowWidth>
        <Layout>
          <Layout.Section>
            <div style={{ marginTop: "100px" }}>
              <Banner title="Missing host query argument" status="critical">
                Your app can only load if the URL has a <b>host</b> argument.
                Please ensure that it is set, or access your app using the
                Partners Dashboard <b>Test your app</b> feature.
              </Banner>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return children;
}