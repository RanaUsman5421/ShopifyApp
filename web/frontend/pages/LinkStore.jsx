import { Banner, Button, TextField, TextStyle } from "@shopify/polaris";
import { useEffect, useState } from "react";
import LionExSideNav from "../components/LionExSideNav";
import LionExTopBar from "../components/LionExTopBar";
import Footer from "../components/Footer";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";
import "../App.css";

const EyeIcon = ({ visible }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5C7 5 2.73 8.11 1 12C2.73 15.89 7 19 12 19C17 19 21.27 15.89 23 12C21.27 8.11 17 5 12 5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    {visible ? <path d="M2 2L22 22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/> : null}
  </svg>
);

export default function LinkStore() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [token, setToken] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [linkStatus, setLinkStatus] = useState({ loading: true, linked: false, userName: "", storeName: "" });

  useEffect(() => {
    let isMounted = true;

    async function loadLinkStatus() {
      try {
        const response = await authenticatedFetch("/api/dashboard/link-status");
        const data = await response.json().catch(() => null);

        if (!isMounted) {
          return;
        }

        setLinkStatus({
          loading: false,
          linked: Boolean(data?.linked),
          userName: data?.userName || "",
          storeName:
            data?.shop?.storeName || data?.storeName || data?.store?.name || "",
        });
      } catch (statusError) {
        if (isMounted) {
          setLinkStatus({ loading: false, linked: false, userName: "" });
        }
      }
    }

    loadLinkStatus();

    return () => {
      isMounted = false;
    };
  }, [authenticatedFetch]);

  async function linkDashboardUser() {
    setIsLinking(true);
    setError("");
    setResult(null);

    try {
      const trimmedToken = token.trim();

      if (!trimmedToken) {
        throw new Error("Please enter the full dashboard token.");
      }

      if (trimmedToken.includes("...")) {
        throw new Error("Please paste the complete dashboard token, not the preview.");
      }

      const request = await authenticatedFetch("/api/dashboard/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: trimmedToken }),
      });

      const responseText = await request.text();
      let response = null;

      try {
        response = responseText ? JSON.parse(responseText) : null;
      } catch (parseError) {
        throw new Error(
          `Invalid server response: ${responseText || "empty response"}`
        );
      }

      if (!request.ok || !response?.success) {
        const serverError =
          response?.error ||
          response?.message ||
          response?.dashboardResponse?.error ||
          response?.dashboardResponse?.message ||
          "Failed to link dashboard user";
        throw new Error(`${serverError} (status: ${request.status})`);
      }

      setResult(response);
      setToken("");
      setLinkStatus({
        loading: false,
        linked: true,
        userName: response.linkedUser?.name || "",
        storeName: response.shop?.storeName || response.shop?.name || "",
      });
    } catch (linkError) {
      setError(linkError.message);
    } finally {
      setIsLinking(false);
    }
  }

  return (
    <div className="lionex-screen">
      <LionExSideNav activeLabel="Link Store" />
      <LionExTopBar className="lionex-topbar--fixed" />
      <main className="lionex-screen-main">
      <div className="home-input-page home-link-page">
        <div className="dashboard-link-card">
          <div className="dashboard-link-card__hero">
            <div className="dashboard-link-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 9.5C5 7.29 6.79 5.5 9 5.5H15C17.21 5.5 19 7.29 19 9.5V14.5C19 16.71 17.21 18.5 15 18.5H9C6.79 18.5 5 16.71 5 14.5V9.5Z" fill="#008170" opacity="0.12"/>
                <path d="M9 12.5H15" stroke="#008170" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M12 9.5V15.5" stroke="#008170" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <TextStyle variation="strong">
              <div className="dashboard-link-title">Link your Shopify Store</div>
            </TextStyle>
            <div className="dashboard-link-subtitle">
              Connect your logistics dashboard to automate shipments, track inventory, and sync orders in real-time.
            </div>
          </div>

          <div className="dashboard-link-body">

            {linkStatus.loading || !linkStatus.linked ? (
              <div className="dashboard-link-form">
            <div className="dashboard-link-info">
              <div className="dashboard-link-info__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="#057A70" strokeWidth="1.8"/>
                  <path d="M12 8V12" stroke="#057A70" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M12 16H12.01" stroke="#057A70" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="dashboard-link-info__content">
                <div className="dashboard-link-info__heading">Before you start</div>
                <div className="dashboard-link-info__text">
                  You can find your unique Dashboard Token in the LionEx Integration Settings under your account profile.
                </div>
              </div>
            </div>
                <div className="token-field-wrapper">
                  <TextField
                    label="Dashboard Token"
                    value={token}
                    onChange={setToken}
                    autoComplete="off"
                    placeholder="sdu_xxxxxxxxxxxxx"
                    disabled={isLinking}
                    type={tokenVisible ? "text" : "password"}
                  />
                  <button
                    type="button"
                    className="token-field-eye"
                    onClick={() => setTokenVisible((visible) => !visible)}
                    aria-label={tokenVisible ? "Hide token" : "Show token"}
                  >
                    <EyeIcon visible={tokenVisible} />
                  </button>
                </div>
                <div className="dashboard-link-actions">
                  <Button
                    fullWidth
                    primary
                    onClick={linkDashboardUser}
                    loading={isLinking}
                    disabled={!token.trim()}
                  >
                    Link Store →
                  </Button>
                </div>
                <div className="dashboard-link-help-text">
                  This token grants LionEx secure access to your order data.
                </div>
              </div>
            ) : (
              <Banner status="success">
                <p>
                  This Store is connected to the LionEx Courier.
                </p>
              </Banner>
            )}

            {error ? (
              <Banner status="critical">
                <p>{error}</p>
              </Banner>
            ) : null}
            {result ? (
              <Banner status="success">
                <p>{result.message}</p>
                <p>
                  {result.linkedUser?.name} is linked to {result.shop?.storeName}. Saved {result.orders?.savedCount || 0} orders to MongoDB.
                </p>
              </Banner>
            ) : null}
          </div>
        </div>
      </div>
      <Footer />
      </main>
    </div>
  );
}
