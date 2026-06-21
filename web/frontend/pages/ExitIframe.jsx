import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Banner, Layout, Page, Spinner } from "@shopify/polaris";

export default function ExitIframe() {
  const { search } = useLocation();
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    if (search) {
      const params = new URLSearchParams(search);
      const redirectUri = params.get("redirectUri");
      const url = new URL(decodeURIComponent(redirectUri));

      if (
        [location.hostname, "admin.shopify.com"].includes(url.hostname) ||
        url.hostname.endsWith(".myshopify.com")
      ) {
        window.open(decodeURIComponent(redirectUri), "_top");
      } else {
        setShowWarning(true);
      }
    }
  }, [search, setShowWarning]);

  return showWarning ? (
    <Page narrowWidth>
      <Layout>
        <Layout.Section>
          <div style={{ marginTop: "100px" }}>
            <Banner title="Redirecting outside of Shopify" status="warning">
              Apps can only use /exitiframe to reach Shopify or the app itself.
            </Banner>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  ) : (
    <Spinner accessibilityLabel="Loading" size="large" />
  );
}