import { useEffect, useMemo, useState } from "react";
import LionExSideNav from "../components/LionExSideNav";
import LionExTopBar from "../components/LionExTopBar";
import Footer from "../components/Footer";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";
import { ORDER_SYNC_COMPLETED_EVENT } from "../utils/orderSync";

const ORDERS_REFRESH_INTERVAL_MS = 30000;

const tabs = ["All", "Unfulfilled", "Unpaid", "Open", "Closed"];

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

function normalizeStatus(status = "") {
  return String(status || "").replace(/_/g, " ").trim().toLowerCase();
}

function displayStatus(status, fallback = "Unknown") {
  const normalized = normalizeStatus(status);

  if (!normalized) {
    return fallback;
  }

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function formatOrderDate(dateString) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (sameDay) {
    return `Today, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  if (isYesterday) {
    return "Yesterday";
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function getOrderName(order) {
  return order.name || order.orderName || (order.orderNumber ? `#${order.orderNumber}` : `#${order.id || "-"}`);
}

function getCustomerName(order) {
  return (
    order.customerName ||
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ||
    order.shipping_address?.name ||
    order.billing_address?.name ||
    order.email ||
    order.phone ||
    "Unknown"
  );
}

function getPaymentStatus(order) {
  return order.financial_status || order.financialStatus || "";
}

function getFulfillmentStatus(order) {
  return order.fulfillment_status || order.fulfillmentStatus || "";
}

function getCreatedAt(order) {
  return order.created_at || order.createdAt || null;
}

function getOrderTotal(order) {
  const rawTotal = order.total_price ?? order.totalPrice;
  const amount = Number(rawTotal);
  const currency = order.currency || "USD";

  if (!Number.isFinite(amount)) {
    return "-";
  }

  return `${amount.toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function getItemCount(order) {
  const count =
    order.item_count ??
    order.itemCount ??
    order.line_items?.length ??
    order.lineItems?.length ??
    order.current_subtotal_line_items_quantity;

  if (!Number.isFinite(Number(count))) {
    return "-";
  }

  const normalizedCount = Number(count);

  return `${normalizedCount} ${normalizedCount === 1 ? "item" : "items"}`;
}

function paymentTone(status) {
  const normalized = normalizeStatus(status);

  if (normalized.includes("unpaid") || normalized.includes("void") || normalized.includes("refunded")) {
    return "error";
  }

  if (normalized.includes("pending") || normalized.includes("authorized") || normalized.includes("partially")) {
    return "pending";
  }

  if (normalized.includes("paid")) {
    return "paid";
  }

  return "neutral";
}

function fulfillmentTone(status) {
  const normalized = normalizeStatus(status);

  if (normalized.includes("fulfilled") && !normalized.includes("unfulfilled")) {
    return "fulfilled";
  }

  if (normalized.includes("partial")) {
    return "partial";
  }

  return "neutral";
}

function isClosed(order) {
  const payment = normalizeStatus(getPaymentStatus(order));
  const fulfillment = normalizeStatus(getFulfillmentStatus(order));

  return payment.includes("paid") && fulfillment.includes("fulfilled") && !fulfillment.includes("unfulfilled");
}

function matchesTab(order, selectedTab) {
  const payment = normalizeStatus(getPaymentStatus(order));
  const fulfillment = normalizeStatus(getFulfillmentStatus(order));

  if (selectedTab === "All") return true;
  if (selectedTab === "Unfulfilled") {
    return fulfillment.includes("unfulfilled") || fulfillment.includes("partial") || !fulfillment;
  }
  if (selectedTab === "Unpaid") {
    return !payment.includes("paid");
  }
  if (selectedTab === "Closed") {
    return isClosed(order);
  }
  if (selectedTab === "Open") {
    return !isClosed(order);
  }

  return true;
}

function MaterialIcon({ children, className = "" }) {
  return <span className={`material-symbols-outlined ${className}`}>{children}</span>;
}

export default function LionExOrdersPage() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [orders, setOrders] = useState([]);
  const [selectedTab, setSelectedTab] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [orderError, setOrderError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadOrders({ showLoading = false } = {}) {
      if (showLoading) {
        setIsLoading(true);
      }
      setOrderError("");

      try {
        const urlStore = getStoreFromUrl();
        const [storeInfoResponse, ordersResponse] = await Promise.all([
          fetchOptionalJson(authenticatedFetch, "/api/store/info", {
            success: true,
            data: { name: urlStore, myshopifyDomain: urlStore },
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
        const storeLookupKey = storeDomain || storeName;
        const shopifyOrders = Array.isArray(ordersResponse?.data) ? ordersResponse.data : [];
        const shopifyOrderCount = Number(ordersResponse?.count) || shopifyOrders.length;
        const orderFetchFailed =
          ordersResponse?.success === false ||
          ordersResponse == null ||
          Boolean(ordersResponse?.fetchError);
        let nextOrders = shopifyOrders;
        let storedOrders = [];

        if (storeLookupKey) {
          const storedOrdersResponse = await fetchOptionalJson(
            authenticatedFetch,
            `/api/orders/store?storename=${encodeURIComponent(storeLookupKey)}`,
            null
          );

          if (Array.isArray(storedOrdersResponse?.data?.orders)) {
            storedOrders = storedOrdersResponse.data.orders;
          }
        }

        if (shopifyOrders.length > 0) {
          await fetchOptionalJson(
            authenticatedFetch,
            "/api/orders/save",
            { savedCount: 0 },
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orders: shopifyOrders }),
            }
          );

          if (storeLookupKey) {
            const refreshedStoredOrdersResponse = await fetchOptionalJson(
              authenticatedFetch,
              `/api/orders/store?storename=${encodeURIComponent(storeLookupKey)}`,
              null
            );

            if (Array.isArray(refreshedStoredOrdersResponse?.data?.orders)) {
              storedOrders = refreshedStoredOrdersResponse.data.orders;
            }
          }
        }

        if (shopifyOrders.length === 0 && storedOrders.length > 0) {
          nextOrders = storedOrders;
        } else if (storedOrders.length >= shopifyOrders.length && storedOrders.length > 0) {
          nextOrders = storedOrders;
        } else if (shopifyOrders.length > 0) {
          nextOrders = shopifyOrders;
        } else if (shopifyOrderCount > 0 && storedOrders.length > 0) {
          nextOrders = storedOrders;
        }

        if (!isMounted) return;

        setOrders(nextOrders);
        if (orderFetchFailed) {
          setOrderError(
            ordersResponse?.fetchError ||
              ordersResponse?.error ||
              "Unable to load live Shopify orders. Showing saved orders if available."
          );
        }
      } catch (error) {
        if (!isMounted) return;
        setOrderError(error?.message || "Unable to load orders.");
        setOrders([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadOrders({ showLoading: true });
    const handleSyncCompleted = () => loadOrders();
    window.addEventListener(ORDER_SYNC_COMPLETED_EVENT, handleSyncCompleted);
    const refreshInterval = window.setInterval(() => loadOrders(), ORDERS_REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.removeEventListener(ORDER_SYNC_COMPLETED_EVENT, handleSyncCompleted);
      window.clearInterval(refreshInterval);
    };
  }, [authenticatedFetch]);

  const filteredOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return orders
      .filter((order) => matchesTab(order, selectedTab))
      .filter((order) => {
        if (!query) return true;

        return [
          getOrderName(order),
          getCustomerName(order),
          order.email,
          order.phone,
          getPaymentStatus(order),
          getFulfillmentStatus(order),
          getOrderTotal(order),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      });
  }, [orders, searchQuery, selectedTab]);

  const pageSize = 10;
  const maxPage = Math.max(0, Math.ceil(filteredOrders.length / pageSize) - 1);
  const currentPage = Math.min(page, maxPage);
  const pagedOrders = filteredOrders.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const pagedOrderKeys = pagedOrders.map((order) => String(order.id || order.shopifyOrderId || getOrderName(order)));
  const allPagedSelected = pagedOrderKeys.length > 0 && pagedOrderKeys.every((key) => selectedOrders.has(key));

  useEffect(() => {
    setPage(0);
    setSelectedOrders(new Set());
  }, [selectedTab, searchQuery]);

  function toggleOrder(orderKey) {
    setSelectedOrders((current) => {
      const next = new Set(current);

      if (next.has(orderKey)) {
        next.delete(orderKey);
      } else {
        next.add(orderKey);
      }

      return next;
    });
  }

  function togglePageOrders() {
    setSelectedOrders((current) => {
      const next = new Set(current);

      if (allPagedSelected) {
        pagedOrderKeys.forEach((key) => next.delete(key));
      } else {
        pagedOrderKeys.forEach((key) => next.add(key));
      }

      return next;
    });
  }

  return (
    <div className="lionex-orders-page">
      <LionExSideNav activeLabel="Orders" />

      <LionExTopBar
        className="lionex-topbar--fixed"
        placeholder="Search orders..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <main className="lionex-orders-main">
        <div className="lionex-orders-content">
          <div className="lionex-orders-header">
            <h2>Orders</h2>
          </div>

          {orderError ? <div className="lionex-orders-error">{orderError}</div> : null}

          <section className="lionex-orders-table-card">
            <div className="lionex-orders-tabsbar">
              <div className="lionex-orders-tabs">
                {tabs.map((tab) => (
                  <button
                    className={`lionex-orders-tab${selectedTab === tab ? " lionex-orders-tab--active" : ""}`}
                    key={tab}
                    type="button"
                    onClick={() => setSelectedTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="lionex-orders-table-actions">
                <button type="button">
                  <MaterialIcon>filter_list</MaterialIcon>
                </button>
                <button type="button">
                  <MaterialIcon>swap_vert</MaterialIcon>
                </button>
              </div>
            </div>

            <div className="lionex-orders-table-scroll">
              <table className="lionex-orders-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={allPagedSelected}
                        onChange={togglePageOrders}
                        aria-label="Select visible orders"
                      />
                    </th>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Payment status</th>
                    <th>Fulfillment status</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td className="lionex-orders-empty" colSpan="8">
                        Loading orders...
                      </td>
                    </tr>
                  ) : pagedOrders.length > 0 ? (
                    pagedOrders.map((order) => {
                      const orderKey = String(order.id || order.shopifyOrderId || getOrderName(order));
                      const paymentStatus = getPaymentStatus(order);
                      const fulfillmentStatus = getFulfillmentStatus(order);

                      return (
                        <tr key={orderKey}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedOrders.has(orderKey)}
                              onChange={() => toggleOrder(orderKey)}
                              aria-label={`Select order ${getOrderName(order)}`}
                            />
                          </td>
                          <td className="lionex-orders-order-link">{getOrderName(order)}</td>
                          <td>{formatOrderDate(getCreatedAt(order))}</td>
                          <td className="lionex-orders-customer">{getCustomerName(order)}</td>
                          <td>
                            <span className={`lionex-orders-pill lionex-orders-pill--${paymentTone(paymentStatus)}`}>
                              {displayStatus(paymentStatus)}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`lionex-orders-pill lionex-orders-pill--${fulfillmentTone(
                                fulfillmentStatus
                              )}`}
                            >
                              {displayStatus(fulfillmentStatus)}
                            </span>
                          </td>
                          <td>{getOrderTotal(order)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="lionex-orders-empty" colSpan="8">
                        No orders match the selected filter or search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="lionex-orders-pagination">
              <p>
                Page {currentPage + 1} of {maxPage + 1} · Showing {filteredOrders.length === 0 ? 0 : currentPage * pageSize + 1}-
                {Math.min((currentPage + 1) * pageSize, filteredOrders.length)} of {filteredOrders.length.toLocaleString()} orders
              </p>
              <div>
                <button
                  type="button"
                  disabled={currentPage === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  <MaterialIcon>chevron_left</MaterialIcon>
                </button>
                <button
                  type="button"
                  disabled={currentPage >= maxPage}
                  onClick={() => setPage((value) => Math.min(maxPage, value + 1))}
                >
                  <MaterialIcon>chevron_right</MaterialIcon>
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
