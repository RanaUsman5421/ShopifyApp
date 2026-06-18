import { LegacyCard as Card, Page, Button, TextField } from "@shopify/polaris";
import React, { useEffect, useMemo, useState } from "react";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";

async function readOptionalJsonResponse(response, fallbackValue) {
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.success === false) {
    return fallbackValue;
  }

  return data || fallbackValue;
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

async function fetchOptionalJson(authenticatedFetch, url, fallbackValue, options) {
  try {
    const response = await authenticatedFetch(url, options);

    return readOptionalJsonResponse(response, fallbackValue);
  } catch (error) {
    return fallbackValue;
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

function formatOrderDate(dateString) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(dateString);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const options = {
    hour: "2-digit",
    minute: "2-digit",
  };

  if (sameDay) {
    return `Today, ${date.toLocaleTimeString([], options)}`;
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function normalizeStatus(status = "") {
  return String(status).trim().toLowerCase();
}

function statusPill(status) {
  const normalized = normalizeStatus(status);

  if (normalized.includes("paid") || normalized.includes("fulfilled")) {
    return "status-pill--success";
  }

  if (normalized.includes("pending") || normalized.includes("partially")) {
    return "status-pill--warning";
  }

  if (normalized.includes("unpaid") || normalized.includes("refunded") || normalized.includes("cancel")) {
    return "status-pill--critical";
  }

  return "status-pill--neutral";
}

function Products() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [stats, setStats] = useState({
    totalOrders: 0,
    savedOrders: 0,
    totalProducts: 0,
    storeStatus: "Checking store connection...",
    storeName: "",
  });
  const [orders, setOrders] = useState([]);
  const [selectedTab, setSelectedTab] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [orderError, setOrderError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadProductPageData() {
      try {
        const urlStore = getStoreFromUrl();
        const storeInfoPromise = fetchOptionalJson(authenticatedFetch, "/api/store/info", {
          success: true,
          data: {
            name: urlStore,
            myshopifyDomain: urlStore,
          },
        });
        const [storeInfoResponse, productsResponse, ordersResponse] = await Promise.all([
          storeInfoPromise,
          fetchOptionalJson(authenticatedFetch, "/api/products/count", {
            success: true,
            count: 0,
            data: { count: 0 },
          }),
          fetchOptionalJson(authenticatedFetch, "/api/orders/all", {
            success: true,
            data: [],
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
        const orderFetchFailed = ordersResponse?.success === false || ordersResponse == null;
        const productCount =
          productsResponse?.count ?? productsResponse?.data?.count ?? 0;

        console.log("Complete store info response:", {
          storeInfoResponse,
          storeName,
          storeDomain,
          urlStore,
          ordersResponse,
        });

        let savedOrders = 0;
        let storedOrdersCount = 0;
        let fetchedOrders = allOrders;

        if (orderFetchFailed) {
          setOrderError(
            ordersResponse?.error || "Unable to load Shopify orders. Showing fallback order data if available."
          );
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
            savedOrders = storedOrdersCount;

            if (orderFetchFailed && Array.isArray(storedOrdersResponse.data?.orders)) {
              fetchedOrders = storedOrdersResponse.data.orders;
            }
          }
        }

        if (!isMounted) {
          return;
        }

        setOrders(fetchedOrders);
        setStats({
          totalOrders: Math.max(allOrders.length, storedOrdersCount),
          savedOrders,
          totalProducts: productCount,
          storeStatus: storeDomain
            ? `Store connected: ${storeDomain}`
            : storeName
            ? "Store connected"
            : "Store information unavailable",
          storeName,
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const urlStore = getStoreFromUrl();

        setStats((current) => ({
          ...current,
          storeName: urlStore || current.storeName,
          storeStatus: urlStore
            ? `Store connected: ${urlStore}`
            : `Store connection error: ${error.message}`,
        }));
      }
    }

    loadProductPageData();

    return () => {
      isMounted = false;
    };
  }, [authenticatedFetch]);

  const statusCounts = useMemo(() => {
    const all = orders.length;
    const unfulfilled = orders.filter((order) =>
      normalizeStatus(order.fulfillment_status).includes("unfulfilled") ||
      normalizeStatus(order.fulfillment_status).includes("partial") ||
      normalizeStatus(order.fulfillment_status).includes("partial")
    ).length;
    const unpaid = orders.filter((order) =>
      !normalizeStatus(order.financial_status).includes("paid")
    ).length;
    const closed = orders.filter((order) =>
      normalizeStatus(order.financial_status).includes("paid") &&
      normalizeStatus(order.fulfillment_status).includes("fulfilled")
    ).length;
    const open = Math.max(0, all - closed);

    return { all, unfulfilled, unpaid, open, closed };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return orders
      .filter((order) => {
        if (selectedTab === "All") {
          return true;
        }

        if (selectedTab === "Unfulfilled") {
          const status = normalizeStatus(order.fulfillment_status);
          return status.includes("unfulfilled") || status.includes("partial") || status === "";
        }

        if (selectedTab === "Unpaid") {
          const status = normalizeStatus(order.financial_status);
          return !status.includes("paid");
        }

        if (selectedTab === "Closed") {
          const financial = normalizeStatus(order.financial_status);
          const fulfillment = normalizeStatus(order.fulfillment_status);
          return financial.includes("paid") && fulfillment.includes("fulfilled");
        }

        if (selectedTab === "Open") {
          const financial = normalizeStatus(order.financial_status);
          const fulfillment = normalizeStatus(order.fulfillment_status);
          return !financial.includes("paid") || !fulfillment.includes("fulfilled");
        }

        return true;
      })
      .filter((order) => {
        if (!query) {
          return true;
        }

        const customerName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim();
        return (
          String(order.name || "").toLowerCase().includes(query) ||
          customerName.toLowerCase().includes(query) ||
          String(order.email || "").toLowerCase().includes(query) ||
          normalizeStatus(order.financial_status).includes(query) ||
          normalizeStatus(order.fulfillment_status).includes(query)
        );
      });
  }, [orders, searchQuery, selectedTab]);

  return (
    <Page fullWidth title="Orders">
      <div className="orders-page">
        <section className="orders-main">
          <div className="orders-page-header">
            
            <div className="orders-page-actions">
              <TextField
                placeholder="Search orders..."
                value={searchQuery}
                onChange={setSearchQuery}
                clearButton
                onClear={() => setSearchQuery("")}
                labelHidden
              />
              <div className="orders-action-buttons">
                <Button outline>Export</Button>
                <Button primary>Create order</Button>
              </div>
            </div>
          </div>

          

          {orderError ? (
            <div className="orders-error-banner">
              {orderError}
            </div>
          ) : null}

          <Card sectioned subdued>
            <div className="orders-table-panel">
              <div className="orders-table-toolbar">
                <div className="orders-tabs">
                  {[
                    { key: "All", label: "All" },
                    { key: "Unfulfilled", label: "Unfulfilled" },
                    { key: "Unpaid", label: "Unpaid" },
                    { key: "Open", label: "Open" },
                    { key: "Closed", label: "Closed" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={`orders-tab ${selectedTab === tab.key ? "orders-tab--active" : ""}`}
                      onClick={() => setSelectedTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="orders-toolbar-actions">
                  <span>{filteredOrders.length} orders shown</span>
                  <Button outline>Bulk Actions</Button>
                </div>
              </div>

              <div className="orders-table-scroll">
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Payment status</th>
                      <th>Fulfillment status</th>
                      <th>Items</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => {
                      const customerName = [
                        order.customer?.first_name,
                        order.customer?.last_name,
                      ]
                        .filter(Boolean)
                        .join(" ") || order.email || order.phone || "Unknown";
                      const total = order.total_price
                        ? `${Number(order.total_price).toFixed(2)} ${order.currency || "USD"}`
                        : "-";
                      return (
                        <tr key={order.id || order.name || Math.random()}>
                          <td className="orders-table-order">
                            <div className="orders-table-order__name">{order.name}</div>
                            <div className="orders-table-order__id">{order.order_number ? `#${order.order_number}` : order.id}</div>
                          </td>
                          <td>{formatOrderDate(order.created_at)}</td>
                          <td>{customerName}</td>
                          <td>
                            <span className={`status-pill ${statusPill(order.financial_status)}`}>
                              {order.financial_status || "Unknown"}
                            </span>
                          </td>
                          <td>
                            <span className={`status-pill ${statusPill(order.fulfillment_status)}`}>
                              {order.fulfillment_status || "Unknown"}
                            </span>
                          </td>
                          <td>{order.item_count || "—"}</td>
                          <td>{total}</td>
                        </tr>
                      );
                    })}
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="orders-table-empty">
                          No orders match the selected filter or search.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </Page>
  );
}

export default Products;
