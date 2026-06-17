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
  const logs = [
    ["14:12:03", "inventory", "Inventory Update", "Synced 142 items from Zone A-4", "Successful"],
    ["13:55:20", "rocket_launch", "Order Dispatch", "Webhook sent to Carrier-DHL: #LX-9902", "Successful"],
    ["13:30:11", "api", "API Handshake", "Re-authenticated Shopify endpoint LX-Primary", "Successful"],
    ["12:45:00", "warning", "System Latency", "Response time exceeded 500ms for Warehouse B", "Warning"],
    ["12:00:15", "cloud_sync", "Global Sync", "Full catalog refresh complete (1,240 SKU)", "Successful"],
  ];

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
            <p>LionEx is currently maintaining a stable connection with your warehouse and inventory hubs. All 14 endpoints are responding within 240ms.</p>
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
              <p>Past 24 hours of connectivity and data exchange</p>
            </div>
            <div>
              <button type="button"><Icon>filter_list</Icon></button>
              <button type="button"><Icon>download</Icon></button>
            </div>
          </header>
          <div className="lionex-log-table-wrap">
            <table className="lionex-log-table">
              <thead>
                <tr><th>Time</th><th>Event Type</th><th>Message</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {logs.map(([time, icon, type, message, status]) => (
                  <tr className={status === "Warning" ? "warning" : ""} key={`${time}-${type}`}>
                    <td>{time}</td>
                    <td><span><Icon>{icon}</Icon>{type}</span></td>
                    <td>{message}</td>
                    <td><strong className={status === "Warning" ? "error" : ""}>{status}</strong></td>
                    <td><button type="button">{status === "Warning" ? "Run Diagnostic" : "View Details"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer><p>Showing 5 of 450 entries</p><nav><button disabled>Previous</button><button>1</button><button>2</button><button>3</button><button>Next</button></nav></footer>
        </section>

        <section className="lionex-image-grid">
          <article>
            <img alt="Server Architecture" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDFx6t2T-Na0tJIrvxaZJmXbs_kz_-xuRaSfAGaiHDHbbqLFCVhBuawPdbCcD2e9v24f41a6LXQa8q3g5SAk-OMOiZfeYgLa5qTDZ1bz4yk4z1N7AQKa6eUwUT1DrTRIE_dmEBfni71x1YxKWtgxLcWSXIS8UjugdEKMJ849k5Xli7dfjrus0oARuMCBdznijifWWh0jq_G5dk3EKoehhA_H4Wo3px0-BLJT3Q5iozcJJIPSj2jz1vgQvde8JCMtpbw9ALv_af6p0RB" />
            <div><h4>Node Resilience</h4><p>Redundant pathways active across 4 global regions.</p></div>
          </article>
          <article>
            <img alt="Warehouse Connection" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA9e83_bzYBVqbrTqDsXYhlnxfcsG-CLPoemH_VMWHvcO9oIG-Pe4YOO2tbjNINv_6lEYGmAoG5LmWJlNfjeZGE02BSq6g0-ThzDIPCZkVmjFmclwMydZQCLsxLBRgJeS8PM4ljHjJEH56do73-ApVziMbgLxB9wyNHJbZ7igxRFVfOUmT4RKt3dR6RsVChuS_7wD3FurFs7inJ7jz3nADY0LDCmXXiFrfr8Yc7bbKO4cTUOyj6sXMpAp1_tlU1qaQtqOAIqhux63mK" />
            <div><h4>Warehouse Mesh</h4><p>Physical and digital inventory mapped in real-time.</p></div>
          </article>
        </section>
      </main>
      <Footer />
    </div>
  );
}
