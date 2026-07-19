import { useState, useEffect, useMemo } from "react";
import { Banner, Button, Card, FormLayout, Select, TextField, LegacyCard, Text } from "@shopify/polaris";
import "../App.css";
import Footer from "../components/Footer";

import LionExSideNav from "../components/LionExSideNav";
import LionExTopBar from "../components/LionExTopBar";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";

function Icon({ children, className = "" }) {
  return <span className={`material-symbols-outlined ${className}`}>{children}</span>;
}

const DEFAULT_SETTINGS = {
  defaultCourier: "M&P",
  defaultWeight: "0.5",
  orderBooking: "Auto",
  defaultService: "Overnight",
};

const COURIER_OPTIONS = ["M&P", "Leopards", "BarqRaftaar", "Trax"];
const WEIGHT_OPTIONS = ["0.5", "1", "1.5", "2", "2.5", "3"];
const BOOKING_OPTIONS = ["Auto", "Manual"];

const SERVICE_OPTIONS_BY_COURIER = {
  "M&P": ["Overnight", "SecondDay"],
  "Leopards": ["Overnight", "Detain", "Overland"],
  "BarqRaftaar": ["Overnight", "Detain", "Overland"],
  "Trax": ["Overnight", "Detain", "Overland"],
};

function getServiceOptions(courier) {
  const services = SERVICE_OPTIONS_BY_COURIER[courier] || ["Overnight"];
  return services.map((service) => ({ label: service, value: service }));
}

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
  };
}

export default function Configuration() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [storeInfo, setStoreInfo] = useState(null);
  const [savedSettings, setSavedSettings] = useState(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] = useState(DEFAULT_SETTINGS);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // Load store info and settings on mount
  useEffect(() => {
    let isMounted = true;

    async function loadStoreInfo() {
      try {
        const response = await authenticatedFetch("/api/dashboard/link-status");
        const data = await response.json().catch(() => null);

        if (!isMounted) return;

        if (data?.linked) {
          setStoreInfo({
            linked: true,
            shopDomain: data?.shopDomain || "",
            linkedAt: new Date().toLocaleDateString(),
          });
          
          // Fetch store settings from the backend
          try {
            const settingsResponse = await authenticatedFetch(
              `/api/dashboard/store-settings?shopDomain=${encodeURIComponent(data?.shopDomain || "")}`
            );
            const settingsData = await settingsResponse.json().catch(() => null);

            if (isMounted && settingsData?.success && settingsData?.settings) {
              const normalized = normalizeSettings(settingsData.settings);
              setSavedSettings(normalized);
              setDraftSettings(normalized);
            }
          } catch (settingsError) {
            console.error("Failed to load store settings:", settingsError);
          }
        } else {
          setStoreInfo({ linked: false });
        }
      } catch (statusError) {
        console.error("Failed to load link status:", statusError);
        setStoreInfo({ linked: false });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadStoreInfo();
    return () => {
      isMounted = false;
    };
  }, [authenticatedFetch]);

  const hasChanges = useMemo(() => {
    return Object.keys(DEFAULT_SETTINGS).some(
      (key) => draftSettings[key] !== savedSettings[key]
    );
  }, [draftSettings, savedSettings]);

  const hasValidWeight =
    /^\d+(\.\d{1,2})?$/.test(draftSettings.defaultWeight) &&
    Number(draftSettings.defaultWeight) > 0;

  function updateSetting(key, value) {
    setDraftSettings((currentSettings) => {
      const nextSettings = { ...currentSettings, [key]: value };
      if (key === "defaultCourier") {
        const services = SERVICE_OPTIONS_BY_COURIER[value] || ["Overnight"];
        if (!services.includes(nextSettings.defaultService)) {
          nextSettings.defaultService = services[0];
        }
      }
      return nextSettings;
    });
    setMessage("");
  }

  function handleDiscard() {
    setDraftSettings(savedSettings);
    setMessage("");
  }

  async function handleSave() {
    if (!hasValidWeight) {
      setMessage("Enter a valid default weight.");
      setError("");
      return;
    }

    if (!storeInfo?.linked) {
      setError("Store is not linked. Please link your store first.");
      setMessage("");
      return;
    }

    setMessage("");
    setError("");
    setIsSaving(true);

    try {
      const response = await authenticatedFetch(
        `/api/dashboard/store-settings?shopDomain=${encodeURIComponent(storeInfo.shopDomain)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(draftSettings),
        }
      );

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Failed to save settings");
      }

      setSavedSettings(draftSettings);
      setMessage("Settings saved successfully.");
    } catch (saveError) {
      setError(saveError.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="lionex-screen">
      <LionExSideNav activeLabel="Configuration" />
      <LionExTopBar className="lionex-topbar--fixed" placeholder="Search settings..." />
      <main className="lionex-screen-main lionex-config-main" style={{ padding: "24px" }}>
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <p style={{ color: "#728087", fontSize: "16px" }}>Loading configuration...</p>
          </div>
        ) : !storeInfo?.linked ? (
          <LegacyCard>
            <LegacyCard.Section>
              <Banner status="warning" title="Store Not Linked">
                <p>Please link your Shopify store first to configure these settings.</p>
              </Banner>
            </LegacyCard.Section>
          </LegacyCard>
        ) : (
          <>
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
                marginTop: "60px",
                marginBottom: "24px",
              }}
            >
              <div>
                <h1 style={{ fontSize: "28px", fontWeight: "700", margin: "0 0 8px 0", color: "#172026" }}>
                  Configuration
                </h1>
                <p style={{ margin: 0, color: "#5d6970", fontSize: "14px" }}>
                  Manage your merchant connection and automated workflows.
                </p>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <Button onClick={handleDiscard} disabled={!hasChanges || isSaving}>
                  Discard changes
                </Button>
                <Button primary onClick={handleSave} disabled={!hasChanges || !hasValidWeight || isSaving}>
                  {isSaving ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </div>

            {/* Status Messages */}
            {error && (
              <Banner status="critical" title="Error">
                {error}
              </Banner>
            )}

            {message && !error && (
              <Banner status="success" title="Success">
                {message}
              </Banner>

            )}

            {/* Settings Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* Store Information Card */}
              <LegacyCard>
                <LegacyCard.Section title="Linked Store">
                  <FormLayout>
                    <TextField
                      label="Store Domain"
                      value={storeInfo.shopDomain}
                      readOnly
                      helpText="Your unique Shopify store identifier."
                    />
                    <TextField
                      label="Linked At"
                      value={storeInfo.linkedAt}
                      readOnly
                      helpText="Date when this store was linked to LionEx."
                    />
                  </FormLayout>
                </LegacyCard.Section>
              </LegacyCard>

              {/* Default Courier Card */}
              <LegacyCard>
                <LegacyCard.Section title="Default Courier">
                  <FormLayout>
                    <Select
                      label="Courier"
                      options={COURIER_OPTIONS.map((option) => ({ label: option, value: option }))}
                      value={draftSettings.defaultCourier}
                      onChange={(value) => updateSetting("defaultCourier", value)}
                      helpText="Select your preferred courier for bookings."
                    />
                  </FormLayout>
                </LegacyCard.Section>
              </LegacyCard>

              {/* Default Weight Card */}
              <LegacyCard>
                <LegacyCard.Section title="Default Weight">
                  <FormLayout>
                    <Select
                      label="Preset Weight (kg)"
                      options={WEIGHT_OPTIONS.map((option) => ({ label: `${option} kg`, value: option }))}
                      value={draftSettings.defaultWeight}
                      onChange={(value) => updateSetting("defaultWeight", value)}
                      helpText="Used when orders lack weight data."
                    />
                    <TextField
                      label="Manual Weight (kg)"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={draftSettings.defaultWeight}
                      onChange={(value) => updateSetting("defaultWeight", value)}
                      error={!hasValidWeight ? "Enter a valid weight (e.g., 0.5, 1.25, 2)" : null}
                      helpText="Enter a custom weight up to 2 decimal places."
                    />
                  </FormLayout>
                </LegacyCard.Section>
              </LegacyCard>

              {/* Default Service Card */}
              <LegacyCard>
                <LegacyCard.Section title="Default Service">
                  <FormLayout>
                    <Select
                      label="Service Type"
                      options={getServiceOptions(draftSettings.defaultCourier)}
                      value={draftSettings.defaultService}
                      onChange={(value) => updateSetting("defaultService", value)}
                      helpText={`Available services for ${draftSettings.defaultCourier}.`}
                    />
                  </FormLayout>
                </LegacyCard.Section>
              </LegacyCard>

              {/* Order Booking Card */}
              <LegacyCard>
                <LegacyCard.Section title="Order Booking">
                  <FormLayout>
                    <Select
                      label="Booking Mode"
                      options={BOOKING_OPTIONS.map((option) => ({ label: option, value: option }))}
                      value={draftSettings.orderBooking}
                      onChange={(value) => updateSetting("orderBooking", value)}
                      helpText="Controls whether orders are booked automatically or manually."
                    />
                    <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "#f0f9f7", borderRadius: "4px", border: "1px solid #d1ece8" }}>
                      <p style={{ margin: "0 0 8px 0", fontWeight: "600", color: "#1a5f54", fontSize: "14px" }}>
                        {draftSettings.orderBooking === "Auto" ? "🚀 Auto Booking" : "📋 Manual Booking"}
                      </p>
                      <p style={{ margin: 0, color: "#0d4840", fontSize: "13px" }}>
                        {draftSettings.orderBooking === "Auto"
                          ? "Orders will be booked automatically during sync."
                          : "Orders remain in 'New' status for manual review before booking."}
                      </p>
                    </div>
                  </FormLayout>
                </LegacyCard.Section>
              </LegacyCard>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
