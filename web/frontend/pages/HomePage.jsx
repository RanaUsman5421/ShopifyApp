import { useEffect, useMemo, useState } from "react";
import LionExSideNav from "../components/LionExSideNav";
import LionExTopBar, { MaterialIcon, SyncButton } from "../components/LionExTopBar";
import Footer from "../components/Footer";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";
import { ORDER_SYNC_COMPLETED_EVENT } from "../utils/orderSync";

const DASHBOARD_REFRESH_INTERVAL_MS = 30000;

async function readOptionalJsonResponse(response, fallbackValue) {
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.success === false) {
    return fallbackValue;
  }

  return data || fallbackValue;
}

async function fetchOptionalJson(authenticatedFetch, url, fallbackValue, options) {
  try {
    const response = await authenticatedFetch(url, options);

    return readOptionalJsonResponse(response, fallbackValue);
  } catch (error) {
    return fallbackValue;
  }
}

function getStoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop");

  if (shop) {
    return shop;
  }

  const host = params.get("host") || window.__SHOPIFY_DEV_HOST;

  if (!host) {
    return "";
  }

  try {
    const paddedHost = host.padEnd(Math.ceil(host.length / 4) * 4, "=");
    const decodedHost = atob(paddedHost.replace(/-/g, "+").replace(/_/g, "/"));
    const storeHandle = decodedHost.match(/\/store\/([^/?]+)/)?.[1];

    return storeHandle ? `${storeHandle}.myshopify.com` : "";
  } catch (error) {
    return "";
  }
}

function normalizeStoreInfoStoreName(name, domain) {
  const rawName = typeof name === "string" ? name.trim() : "";
  const rawDomain = typeof domain === "string" ? domain.trim() : "";

  if (rawName && !rawName.toLowerCase().endsWith(".myshopify.com")) {
    return rawName;
  }

  if (rawDomain) {
    return rawDomain.replace(/\.myshopify\.com$/i, "");
  }

  return rawName || rawDomain || "";
}

function formatMetricValue(value, isLoading) {
  if (isLoading) {
    return "Loading...";
  }

  return Number(value || 0).toLocaleString();
}

function formatSyncEventTime(dateString) {
  if (!dateString) {
    return "Unavailable";
  }

  const date = new Date(dateString);

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSyncInterval(intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return "Unknown interval";
  }

  return `${Math.round(intervalMs / 60000)} minutes`;
}

function formatNextSyncTime(dateString) {
  if (!dateString) {
    return "Unknown";
  }

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) {
    return "Now";
  }

  if (diffMs < 60000) {
    return "In a few seconds";
  }

  if (diffMs < 3600000) {
    const minutes = Math.round(diffMs / 60000);
    return `In ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  if (diffMs < 86400000) {
    const hours = Math.round(diffMs / 3600000);
    return `In ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.round(diffMs / 86400000);
  return `In ${days} day${days === 1 ? "" : "s"}`;
}

function formatOrderCount(count) {
  return `${Number.isFinite(count) ? count : 0} order${count === 1 ? "" : "s"}`;
}

const healthItems = [
  { label: "API Connection", status: "STABLE", tone: "success" },
  { label: "Orders Syncing", status: "SYNCED", tone: "success" },
  { label: "Order Processing", status: " ON ", tone: "success" },
];

export default function LionExHomePage() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [dashboardStats, setDashboardStats] = useState({
    totalOrders: 0,
    savedOrders: 0,
    totalProducts: 0,
    storeName: "",
    isLoading: true,
  });
  const [nextSyncTime, setNextSyncTime] = useState("Loading...");
  const [lastOrdersSyncTime, setLastOrdersSyncTime] = useState("Unavailable");
  const [syncInterval, setSyncInterval] = useState("Unknown interval");
  const [ordersFetchedCount, setOrdersFetchedCount] = useState(0);
  const [ordersSavedLastSync, setOrdersSavedLastSync] = useState(0);
  const [syncCompletionPercentage, setSyncCompletionPercentage] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardStats() {
      try {
        const urlStore = getStoreFromUrl();
        const [storeInfoResponse, productsResponse, ordersResponse] = await Promise.all([
          fetchOptionalJson(authenticatedFetch, "/api/store/info", {
            success: true,
            data: {
              name: urlStore,
              myshopifyDomain: urlStore,
            },
          }),
          fetchOptionalJson(authenticatedFetch, "/api/products/count", {
            success: true,
            count: 0,
            data: { count: 0 },
          }),
          fetchOptionalJson(authenticatedFetch, "/api/orders/all", {
            success: true,
            data: [],
            count: 0,
          }),
        ]);

        const storeName =
          storeInfoResponse.data?.displayName ||
          normalizeStoreInfoStoreName(
            storeInfoResponse.data?.name,
            storeInfoResponse.data?.myshopifyDomain
          ) ||
          urlStore ||
          "";
        const storeDomain = storeInfoResponse.data?.myshopifyDomain || urlStore || "";
        const allOrders = Array.isArray(ordersResponse?.data) ? ordersResponse.data : [];
        const shopifyOrderCount = Number(ordersResponse?.count) || allOrders.length;
        const productCount =
          productsResponse?.count ?? productsResponse?.data?.count ?? 0;

        let savedOrders = 0;
        let storedOrdersCount = 0;

        if (allOrders.length > 0) {
          const saveResponse = await fetchOptionalJson(
            authenticatedFetch,
            "/api/orders/save",
            { savedCount: 0 },
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ orders: allOrders }),
            }
          );
          savedOrders = saveResponse.savedCount || 0;
        }

        const storeLookupKey = storeDomain || storeName;

        if (storeLookupKey) {
          const storedOrdersResponse = await fetchOptionalJson(
            authenticatedFetch,
            `/api/orders/store?storename=${encodeURIComponent(storeLookupKey)}`,
            null
          );

          if (storedOrdersResponse?.success) {
            storedOrdersCount = Array.isArray(storedOrdersResponse.data?.orders)
              ? storedOrdersResponse.data.orders.length
              : 0;
            savedOrders = storedOrdersCount || savedOrders;
          }
        } 

        const syncStatusResponse = await fetchOptionalJson(
          authenticatedFetch,
          "/api/orders/sync-status",
          { success: true, data: {} }
        );
        const nextRunAt = syncStatusResponse?.data?.nextRunAt;
        const lastRunAt = syncStatusResponse?.data?.lastRunAt;
        const intervalMs = syncStatusResponse?.data?.intervalMs;
        const nextSyncDisplay = formatNextSyncTime(nextRunAt);

        if (!isMounted) {
          return;
        }

        setNextSyncTime(nextSyncDisplay);
        setLastOrdersSyncTime(formatSyncEventTime(lastRunAt));
        setSyncInterval(formatSyncInterval(intervalMs));
        setOrdersFetchedCount(Math.max(shopifyOrderCount, allOrders.length, storedOrdersCount));
        setOrdersSavedLastSync(savedOrders);
        setSyncCompletionPercentage(
          Math.max(shopifyOrderCount, allOrders.length, storedOrdersCount) > 0
            ? Math.round((savedOrders / Math.max(shopifyOrderCount, allOrders.length, storedOrdersCount)) * 100)
            : 0
        );

        setDashboardStats({
          totalOrders: Math.max(shopifyOrderCount, allOrders.length, storedOrdersCount),
          savedOrders,
          totalProducts: productCount,
          storeName,
          isLoading: false,
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const urlStore = getStoreFromUrl();

        setDashboardStats((current) => ({
          ...current,
          storeName: urlStore ? normalizeStoreInfoStoreName("", urlStore) : current.storeName,
          isLoading: false,
        }));
        setNextSyncTime("Unavailable");
        setLastOrdersSyncTime("Unavailable");
        setSyncInterval("Unknown interval");
        setOrdersFetchedCount(0);
        setOrdersSavedLastSync(0);
        setSyncCompletionPercentage(0);
      }
    }

    function handleSyncCompleted() {
      loadDashboardStats();
    }

    loadDashboardStats();
    window.addEventListener(ORDER_SYNC_COMPLETED_EVENT, handleSyncCompleted);
    const refreshInterval = window.setInterval(loadDashboardStats, DASHBOARD_REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.removeEventListener(ORDER_SYNC_COMPLETED_EVENT, handleSyncCompleted);
      window.clearInterval(refreshInterval);
    };
  }, [authenticatedFetch]);

  const metrics = useMemo(() => {
    const { totalOrders, savedOrders, totalProducts, isLoading } = dashboardStats;
    const sentRate =
      totalOrders > 0 ? `${Math.round((savedOrders / totalOrders) * 100)}% of total orders` : "No orders yet";

    return [
      {
        label: "Total Orders",
        icon: "shopping_bag",
        value: formatMetricValue(totalOrders, isLoading),
        trendIcon: "trending_up",
        trend: isLoading ? "Loading..." : "From your Shopify store",
        mutedTrend: false,
      },
      {
        label: "Sent to LionEx",
        icon: "local_shipping",
        value: formatMetricValue(savedOrders, isLoading),
        trendIcon: "check_circle",
        trend: isLoading ? "Loading..." : sentRate,
        mutedTrend: true,
      },
      {
        label: "Total Products",
        icon: "inventory_2",
        value: formatMetricValue(totalProducts, isLoading),
        trendIcon: "inventory",
        trend: isLoading ? "Loading..." : "In your Shopify catalog",
        mutedTrend: false,
      },
    ];
  }, [dashboardStats]);

  const storeDisplayName = dashboardStats.isLoading
    ? "Loading..."
    : dashboardStats.storeName || "Store unavailable";

  const orderSyncActivityItems = [
    {
      icon: "schedule",
      title: "Last orders sync",
      detail: lastOrdersSyncTime,
      status: "Completed",
      time: "",
      tone: "success",
    },
    {
      icon: "shopping_cart",
      title: "Orders fetched from Shopify Store",
      detail: formatOrderCount(ordersFetchedCount),
      status: "Live",
      time: "Real-time",
      tone: "success",
    },
    {
      icon: "storage",
      title: "Orders sent to LionEx",
      detail: formatOrderCount(ordersSavedLastSync),
      status: "Synced",
      time: "Last sync",
      tone: "success",
    },
  ];

  const mergedActivityItems = orderSyncActivityItems;

  return (
    <div className="lionex-home">
      <LionExSideNav activeLabel="Home" />

      <main className="lionex-main">
        <LionExTopBar />

        <div className="lionex-content">
          <section className="lionex-page-header">
            <div>
              <h2>LionEx Dashboard</h2>
              <p>Manage your E-Commerce and Shopify synchronization in one place.</p>
            </div>
          </section>

          <section className="lionex-metrics" aria-label="Dashboard metrics">
            {metrics.map((metric) => (
              <article className="lionex-card lionex-metric" key={metric.label}>
                <div className="lionex-metric__top">
                  <span>{metric.label}</span>
                  <div className="lionex-metric__icon">
                    <MaterialIcon>{metric.icon}</MaterialIcon>
                  </div>
                </div>
                <div className="lionex-metric__value">{metric.value}</div>
                <div className={metric.mutedTrend ? "lionex-metric__trend muted" : "lionex-metric__trend"}>
                  <MaterialIcon>{metric.trendIcon}</MaterialIcon>
                  <span>{metric.trend}</span>
                </div>
              </article>
            ))}
          </section>

          <section className="lionex-status-grid">
            <article className="lionex-card lionex-sync-card">
              <div className="lionex-card__header">
                <h3>Sync Status</h3>
                <span className="lionex-connected">
                  <span />
                  Connected
                </span>
              </div>

              <div className="lionex-sync-card__body">
                <div className="lionex-store">
                  <div className="lionex-store__icon">
                    <img
                      alt="Shopify Store Icon"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuA8QjabqXTZ4YAa_o6X-A-dMh30U3ELE2kYcjKJc3hBZtrJ6Iv85ZT0nf9GWBTxg09LinRDeNp5nig1MsaaRdTIzbu0oo0ws7NIEHqShxjvF3y9hrnv--I4h5zJjtxt3UGr7lOi0REVkUBer5i-uQXP4vqXMzF-t7HEFEhwJrAdRdgfDEJhHd3Wn9E6CDDItAFtZOWL4_mebdzDRqVGMBT-I5CtoltEbVYAQG2EH6-C8pB5nD4YW_bDVKX3RVs2Ofp4ig70lcADba4C"
                    />
                    <div>
                      <MaterialIcon filled>sync</MaterialIcon>
                    </div>
                  </div>
                  <div className="lionex-store__details">
                    <p>Connected Store</p>
                    <h4>{storeDisplayName}</h4>
                    <div className="lionex-store__meta">
                      <span>
                        <MaterialIcon>calendar_today</MaterialIcon>
                      Next Sync: {nextSyncTime}
                      </span>
                      <span>
                        <MaterialIcon>update</MaterialIcon>
                        Interval: 10 Minutes
                      </span>
                    </div>
                  </div>
                </div>

                <div className="lionex-progress">
                  <div>
                    <span>Last sync completion: {syncCompletionPercentage}%</span>
                    <strong>In Progress...</strong>
                  </div>
                  <div className="lionex-progress__track">
                    <span />
                  </div>
                </div>

                <div className="lionex-info-banner">
                  <MaterialIcon>info</MaterialIcon>
                  <div>
                    <p>Auto-Sync is active</p>
                    <span>
                      Your orders are automatically synced every 10 minutes. No manual
                      action is required for basic operations.
                    </span>
                  </div>
                </div>
              </div>
            </article>

            <article className="lionex-card lionex-health">
              <div className="lionex-card__header">
                <h3>Logistics Health</h3>
              </div>
              <div className="lionex-health__body">
                <div className="lionex-health__list">
                  {healthItems.map((item) => (
                    <div className="lionex-health__item" key={item.label}>
                      <div>
                        <span className={`lionex-dot lionex-dot--${item.tone}`} />
                        <span>{item.label}</span>
                      </div>
                      <strong className={`lionex-tone--${item.tone}`}>{item.status}</strong>
                    </div>
                  ))}
                </div>

                <div className="lionex-efficiency">
                  <div className="lionex-efficiency__circle">
                    <svg viewBox="0 0 88 88" aria-hidden="true">
                      <circle cx="44" cy="44" r="36" />
                      <circle cx="44" cy="44" r="36" />
                    </svg>
                    <strong>80%</strong>
                  </div>
                  <p>Orders Booking Rate</p>
                </div>
              </div>
            </article>
          </section>

          <section className="lionex-card lionex-activity">
            <div className="lionex-card__header">
              <h3>Recent Sync Activity</h3>
            </div>
            <div className="lionex-activity__list">
              {mergedActivityItems.map((item) => (
                <div className="lionex-activity__item" key={item.title}>
                  <div className={`lionex-activity__icon lionex-activity__icon--${item.tone}`}>
                    <MaterialIcon>{item.icon}</MaterialIcon>
                  </div>
                  <div>
                    <p>{item.title}</p>
                    <span>{item.detail}</span>
                  </div>
                  <div className="lionex-activity__status">
                    <strong className={`lionex-tone--${item.tone}`}>{item.status}</strong>
                    <span>{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <Footer />
      </main>
    </div>
  );
}

