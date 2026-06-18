import "../App.css";

import { useEffect, useState } from "react";
import Footer from "../components/Footer";
import LionExSideNav from "../components/LionExSideNav";
import LionExTopBar from "../components/LionExTopBar";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";
import { ORDER_SYNC_COMPLETED_EVENT, triggerOrderSync } from "../utils/orderSync";

async function readJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || data?.message || fallbackMessage);
  }

  return data;
}

function formatCountdown(nextRunAt) {
  if (!nextRunAt) {
    return "--:--";
  }

  const remainingMs = new Date(nextRunAt).getTime() - Date.now();

  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatOrdersSyncTime(dateString) {
  if (!dateString) {
    return "No orders synced yet";
  }

  const date = new Date(dateString);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const timeOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };

  if (sameDay) {
    return `Today, ${date.toLocaleTimeString([], timeOptions)}`;
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function getSyncProgress(lastRunAt, nextRunAt) {
  if (!lastRunAt || !nextRunAt) {
    return 0;
  }

  const start = new Date(lastRunAt).getTime();
  const end = new Date(nextRunAt).getTime();
  const span = end - start;

  if (!Number.isFinite(span) || span <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, ((Date.now() - start) / span) * 100));
}

function Icon({ children, className = "" }) {
  return <span className={`material-symbols-outlined ${className}`}>{children}</span>;
}

export function applySyncStatus(status, setSyncTimer) {
  const nextRunAt = status?.nextRunAt || null;
  const lastRunAt = status?.lastRunAt || null;

  setSyncTimer((current) => ({
    ...current,
    nextRunAt,
    lastRunAt,
    isSyncRunning: Boolean(status?.isSyncRunning),
    countdown: formatCountdown(nextRunAt),
    syncProgress: getSyncProgress(lastRunAt, nextRunAt),
  }));
}


export default function SyncStatus() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [syncTimer, setSyncTimer] = useState({
    nextRunAt: null,
    lastRunAt: null,
    isSyncRunning: false,
    countdown: "Loading...",
    syncProgress: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [eventLogs, setEventLogs] = useState([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadSyncStatus() {
      try {
        const request = await authenticatedFetch("/api/orders/sync-status");
        const response = await readJsonResponse(
          request,
          "Failed to load order sync status"
        );

        if (isMounted) {
          applySyncStatus(response.data, setSyncTimer);
          // fetch recent order-related events to display in the event history table
          try {
            const ordersResp = await authenticatedFetch("/api/orders/all");
            const ordersJson = await ordersResp.json().catch(() => null);

            const ordersArray = Array.isArray(ordersJson?.data) ? ordersJson.data : [];
            // build a compact list of recent order events (most recent first)
            const recent = ordersArray
              .slice()
              .sort((a, b) => {
                const ta = new Date(a.created_at || a.createdAt || 0).getTime();
                const tb = new Date(b.created_at || b.createdAt || 0).getTime();
                return tb - ta;
              })
              .slice(0, 50)
                .map((order) => {
                  const created = order.created_at || order.createdAt || null;
                  const time = created ? new Date(created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';
                  const fulfillment = (order.fulfillment_status || order.fulfillmentStatus || '').toLowerCase();
                  const payment = (order.financial_status || order.financialStatus || '').toLowerCase();
                  const statusLabel = payment.includes('void') || payment.includes('refunded') ? 'Warning' : 'Successful';
                  const eventType = fulfillment.includes('fulfilled') ? 'Order Fulfilled' : 'Order Synced';
                  const icon = 'shopping_cart';
                  const orderName = order.name || order.orderName || (order.orderNumber ? `#${order.orderNumber}` : `#${order.id || '-'}`);
                  const customer = order.customer?.first_name || order.customerName || order.email || order.phone || 'Customer';
                  const total = (() => {
                    const raw = order.total_price ?? order.totalPrice ?? order.total;
                    const num = Number(raw);
                    return Number.isFinite(num) ? `${num.toFixed(2)}` : (raw ? String(raw) : '-');
                  })();

                  const message = `${orderName} · ${total}`;

                  return [time, icon, eventType, message, statusLabel, customer];
                });

            setEventLogs(recent);
          } catch (e) {
            // keep fallback logs if fetching fails
            console.error('Failed to fetch recent orders for event history:', e);
          }
        }
      } catch (error) {
        if (isMounted) {
          setSyncTimer((current) => ({
            ...current,
            nextRunAt: null,
            lastRunAt: null,
            isSyncRunning: false,
            countdown: "--:--",
            syncProgress: 0,
          }));
        }
      }
    }

    function handleSyncCompleted(event) {
      if (event.detail) {
        applySyncStatus(event.detail, setSyncTimer);
        setSyncing(false);
      }
    }

    loadSyncStatus();
    window.addEventListener(ORDER_SYNC_COMPLETED_EVENT, handleSyncCompleted);
    const statusInterval = window.setInterval(loadSyncStatus, 30000);
    const countdownInterval = window.setInterval(() => {
      setSyncTimer((current) => ({
        ...current,
        countdown: formatCountdown(current.nextRunAt),
        syncProgress: getSyncProgress(current.lastRunAt, current.nextRunAt),
      }));
    }, 1000);

    return () => {
      isMounted = false;
      window.removeEventListener(ORDER_SYNC_COMPLETED_EVENT, handleSyncCompleted);
      window.clearInterval(statusInterval);
      window.clearInterval(countdownInterval);
    };
  }, [authenticatedFetch]);

  const isOrdersSyncActive = syncing || syncTimer.isSyncRunning;
  const syncProgressPercent = isOrdersSyncActive ? 100 : Math.round(syncTimer.syncProgress);
  const fallbackLogs = [
    ["14:12:03", "inventory", "Inventory Update", "Synced 142 items from Zone A-4", "Successful"],
    ["13:55:20", "rocket_launch", "Order Dispatch", "Webhook sent to Carrier-DHL: #LX-9902", "Successful"],
    ["13:30:11", "api", "API Handshake", "Re-authenticated Shopify endpoint LX-Primary", "Successful"],
    ["12:45:00", "warning", "System Latency", "Response time exceeded 500ms for Warehouse B", "Warning"],
    ["12:00:15", "cloud_sync", "Global Sync", "Full catalog refresh complete (1,240 SKU)", "Successful"],
  ];

  const displayLogs = eventLogs && eventLogs.length > 0 ? eventLogs : fallbackLogs;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(displayLogs.length / pageSize));
  const maxPage = Math.max(0, totalPages - 1);
  const currentPage = Math.min(page, maxPage);
  const startIndex = displayLogs.length === 0 ? 0 : currentPage * pageSize + 1;
  const endIndex = Math.min((currentPage + 1) * pageSize, displayLogs.length);
  const pagedLogs = displayLogs.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const pagerWindowSize = Math.min(5, totalPages);
  const pagerStart = Math.max(0, Math.min(currentPage - Math.floor(pagerWindowSize / 2), totalPages - pagerWindowSize));

  async function handleManualResync() {
    if (syncing || syncTimer.isSyncRunning) {
      return;
    }

    setSyncing(true);

    try {
      const response = await triggerOrderSync(authenticatedFetch);
      if (response?.data?.status) {
        applySyncStatus(response.data.status, setSyncTimer);
      }
    } catch (error) {
      console.error("Manual order sync failed:", error);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="lionex-screen">
      <LionExSideNav activeLabel="Sync Status" />
      <LionExTopBar className="lionex-topbar--fixed" placeholder="Search logs or orders..." />
      <main className="lionex-screen-main">
        <section className="lionex-sync-hero-grid">
          <article className="lionex-sync-hero">
            <Icon className="lionex-sync-hero__watermark">sync</Icon>
            <div className="lionex-pulse" />
            <span>Real-time Connection: Active</span>
            <h2>Systems Synchronized</h2>
            <p>LionEx is currently maintaining a stable connection with your Store. All Endpoints are responding within 10 Minutes.</p>
            <div>
              <button type="button" onClick={handleManualResync} disabled={syncing || syncTimer.isSyncRunning}>
                <Icon className={syncing ? "lionex-spin" : ""}>sync</Icon>
                {syncing ? "Synchronizing..." : "Manual Re-sync"}
              </button>
              <button type="button">View Topology</button>
            </div>
          </article>
          <article className="lionex-next-sync">
            <div>
              <span>Next Scheduled Orders Sync</span>
              <Icon>schedule</Icon>
            </div>
            <h3>{syncTimer.countdown}</h3>
            <p>Last orders sync: {formatOrdersSyncTime(syncTimer.lastRunAt)}</p>
            <div className="lionex-next-sync__bar"><span style={{ width: `${syncProgressPercent}%` }} /></div>
            <footer>
              <span>{syncProgressPercent}% until next sync</span>
              <strong>{isOrdersSyncActive ? "Syncing orders" : "Orders sync idle"}</strong>
            </footer>
          </article>
        </section>

        <section className="lionex-log-card">
          <header>
            <div>
              <h3>Sync Event History</h3>
            </div>
          </header>
          <div className="lionex-log-table-wrap" style={{ overflowX: 'hidden' }}>
            <table className="lionex-log-table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead>
                <tr><th>Time</th><th>Event Type</th><th>Name</th><th>Message</th></tr>
              </thead>
              <tbody>
                {pagedLogs.map(([time, icon, type, message, status, name]) => (
                  <tr className={status === "Warning" ? "warning" : ""} key={`${time}-${type}-${name}`}>
                    <td style={{ whiteSpace: 'nowrap', width: '85px' }}>{time}</td>
                    <td style={{ whiteSpace: 'nowrap', width: '140px' }}><span><Icon>{icon}</Icon>{type}</span></td>
                    <td style={{ whiteSpace: 'nowrap', width: '180px' }}>{name}</td>
                    <td style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{message}</td>
                    <td style={{ whiteSpace: 'nowrap', width: '110px' }}><strong className={status === "Warning" ? "error" : ""}>{status}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer>
            <p>Showing {startIndex}-{endIndex} of {displayLogs.length.toLocaleString()} entries</p>
            <nav>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                style={{ background: 'transparent', boxShadow: 'none', borderColor: 'transparent' }}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                disabled={currentPage >= maxPage}
                style={{ background: 'transparent', boxShadow: 'none', borderColor: 'transparent' }}
              >
                Next
              </button>
            </nav>
          </footer>
        </section>

        <section className="lionex-image-grid">
          <article>
            <img alt="E-commerce packages" src="https://news.mit.edu/sites/default/files/images/202110/MIT-Wise-Systems-01.jpg" />
            <div>
              <h4>Order Sync & Dispatch</h4>
              <p>Real-time import of Shopify orders into LionEx so shipments can be created and dispatched automatically.</p>
            </div>
          </article>
          <article>
            <img alt="Courier delivery van" src="https://plus.unsplash.com/premium_photo-1681488262364-8aeb1b6aac56?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8ZSUyMGNvbW1lcmNlfGVufDB8fDB8fHww" />
            <div>
              <h4>Courier Integration</h4>
              <p>Connect multiple carriers to automatically generate shipping labels, track deliveries, and surface status updates in your store.</p>
            </div>
          </article>
        </section>
      </main>
      <Footer />
    </div>
  );
}
