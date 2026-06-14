import { useEffect, useState } from "react";
import LionExSideNav from "./LionExSideNav";
import LionExTopBar from "./LionExTopBar";
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

export function formatNextSyncTime(dateString) {
  if (!dateString) {
    return "Unavailable";
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
  };

  if (sameDay) {
    return `Today, ${date.toLocaleTimeString([], timeOptions)}`;
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
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

function Footer() {
  return (
    <footer className="lionex-screen-footer">
      <p>&copy; 2024 LionEx Logistics. All rights reserved.</p>
      <nav>
        <a href="#">Terms of Service</a>
        <a href="/privacyPolicy">Privacy Policy</a>
        <a href="#">API Documentation</a>
        <a href="#">Support</a>
      </nav>
    </footer>
  );
}

export function LionExSyncStatusPage() {
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

export function LionExConfigurationPage() {
  const [frequency, setFrequency] = useState("1 Hour");
  const [toggles, setToggles] = useState({ email: true, stock: true, errors: false });
  const frequencies = [["1 Hour", "speed", "Real-time focus"], ["4 Hours", "schedule", "Balanced load"], ["24 Hours", "history", "Batch processing"]];

  return (
    <div className="lionex-screen">
      <LionExSideNav activeLabel="Configuration" />
      <LionExTopBar className="lionex-topbar--fixed" placeholder="Search settings..." />
      <main className="lionex-screen-main lionex-config-main">
        <div className="lionex-config-header">
          <div><h2>Configuration</h2><p>Manage your merchant connection and automated workflows.</p></div>
          <div><button>Discard changes</button><button>Save changes</button></div>
        </div>
        <section className="lionex-config-grid">
          <article className="lionex-config-card wide">
            <header><div><Icon>key</Icon></div><section><h3>API Integration</h3><p>Secure your merchant account with LionEx tokens.</p></section><strong>ACTIVE</strong></header>
            <main className="lionex-api-fields">
              <label><span>Integration Token</span><div><code>lx_live_83kdn29snsl382ns9s_secure</code><button><Icon>content_copy</Icon></button></div><p>This token grants full access to your order management.</p></label>
              <label><span>Webhook URL</span><div><input readOnly value="https://api.lionex.io/hooks/v1/4921" /></div><p>LionEx webhooks are triggered on order delivery.</p></label>
            </main>
            <footer><button><Icon>refresh</Icon>Rotate Security Credentials</button></footer>
          </article>
          <article className="lionex-config-card prefs">
            <header><section><h3>Sync Preferences</h3></section></header>
            <main>
              <p>Choose how often LionEx should pull updates from your inventory and orders.</p>
              <div className="lionex-frequency-grid">
                {frequencies.map(([label, icon, note]) => (
                  <button className={frequency === label ? "active" : ""} key={label} onClick={() => setFrequency(label)}>
                    <Icon>{icon}</Icon><strong>{label}</strong><span>{note}</span>{frequency === label ? <Icon>check_circle</Icon> : null}
                  </button>
                ))}
              </div>
              <aside><Icon>info</Icon><span>Frequent syncing may increase API usage and consume higher bandwidth during peak hours.</span></aside>
            </main>
          </article>
          <article className="lionex-config-card notifications">
            <header><section><h3>Notifications</h3></section></header>
            <main>
              {[
                ["email", "Email Summaries", "Daily digest of activities"],
                ["stock", "Low Stock Alerts", "Notify when below threshold"],
                ["errors", "Sync Errors", "Immediate alert on failure"],
              ].map(([key, title, note]) => (
                <label className="lionex-toggle-row" key={key}>
                  <span><strong>{title}</strong><small>{note}</small></span>
                  <input checked={toggles[key]} onChange={() => setToggles((value) => ({ ...value, [key]: !value[key] }))} type="checkbox" />
                  <i />
                </label>
              ))}
            </main>
          </article>
          <article className="lionex-config-card wide">
            <header><section><h3>Order Automation Rules</h3></section></header>
            <main className="lionex-rules">
              <div><Icon>priority_high</Icon><section><strong>Auto-sync high priority orders</strong><span>Bypass queue for orders over $500 or marked 'Express'</span></section><em>Enabled</em><button><Icon>delete</Icon></button></div>
              <div><Icon>map</Icon><section><strong>International Handling</strong><span>Apply custom duty documentation for non-domestic shipping</span></section><em>Disabled</em><button><Icon>delete</Icon></button></div>
              <button><Icon>add</Icon>Create custom automation rule</button>
            </main>
          </article>
          <article className="lionex-config-image wide">
            <img alt="Modern logistics warehouse office" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCMqj6oB8-_mRLNTGykTRFIy3u2BqYUAuXlfEwBuy1s_j_uiiBOjGa5TbShyBxb4_sNvOM3KiY-3yohAt7GQD4B1y8PCtalEKMjtX4SHKJwPU6_yByCIsePTHhKAek8VhUa4Iw539nfFEiY7jQfzW3HvzmksduKiNkN2iNWQFvgHKJykv5tQlqJp3iqpNSWwZd2RwOuXYJM1YBZZjZ5Zdy6IzvTQWAk-0yxJOL4v0k32rqqdnDxdQ5X3tMNcUFsVp7aGnxPqcg1y7PW" />
            <div><h4>Need a custom workflow?</h4><p>LionEx offers white-glove integration services for enterprise merchants with complex shipping logic.</p><button>Contact Expert</button></div>
          </article>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export function LionExPrivacyPolicyPage() {
  return (
    <div className="lionex-screen lionex-privacy-screen">
      <LionExSideNav activeLabel="Privacy Policy" />
      <LionExTopBar className="lionex-topbar--fixed" placeholder="Search policy..." />
      <main className="lionex-screen-main">
        <div className="lionex-privacy-header"><a href="/configuration"><Icon>arrow_back</Icon> Settings</a><h1>Privacy Policy</h1><p>Last updated: May 24, 2024</p></div>
        <div className="lionex-policy-grid">
          <aside>
            <section><h2>In this policy</h2><a href="#data-collection"><Icon>database</Icon>Data Collection</a><a href="#data-usage"><Icon>insights</Icon>Data Usage & Storage</a><a href="#user-rights"><Icon>gavel</Icon>User Rights</a><a href="#compliance"><Icon>verified_user</Icon>Compliance</a></section>
            <section><Icon>info</Icon><div><h3>Questions?</h3><p>Our legal team is here to help merchants understand their data sovereignty.</p><a href="mailto:legal@lionex.logistics">Contact Support</a></div></section>
          </aside>
          <div>
            <PolicySection id="data-collection" title="1. Data Collection">
              <p>LionEx collects specific information to facilitate global logistics synchronization between your Shopify store and regional shipping carriers.</p>
              <div className="lionex-policy-cards"><article><Icon>store</Icon><h4>Store Information</h4><p>Store name, email, and currency settings to configure shipping zones correctly.</p></article><article><Icon>local_shipping</Icon><h4>Order Details</h4><p>Customer names, delivery addresses, and SKU quantities for label generation.</p></article></div>
            </PolicySection>
            <PolicySection id="data-usage" title="2. Data Usage & Storage">
              <p>We utilize high-performance cloud infrastructure to ensure your logistics data is processed in real-time.</p>
              <figure><img alt="Secure Data Infrastructure" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDjfy7Lvm7cAyjrUbH4M27jrpUeiC0YbVOwVPM2TLqYqTaVfddI00N2JZbNdgTXE1nizl8dRBKWN7gTRl2UMsTVWKuqzp3mk3uWRNkudKIkF8OlmNtgPQ4hqWgNyN4ms9iGgD49Z1jSQtgmlECRAkliML9a8slibwbtHBgLCTqPcQ92DM3MyOxNmeY5luT_xrevnXSG-qAHp5gjql0Y8u2ix7Y2Iqaf8t6Omloszgd9igBDXWTn0KSNQtMHO7ZGPc9lFMzwECyMM-rQ" /><figcaption>Enterprise-Grade Security Protocol</figcaption></figure>
              <div className="lionex-policy-feature"><Icon>storage</Icon><section><h4>MongoDB Atlas Storage</h4><p>We store active order data in encrypted MongoDB clusters to enable rapid retrieval and bulk sync operations.</p></section></div>
              <div className="lionex-policy-feature"><Icon>sync_alt</Icon><section><h4>Third-Party Carrier APIs</h4><p>Data is only shared with shipping carriers when you explicitly click "Sync Now" for a specific order.</p></section></div>
            </PolicySection>
            <PolicySection id="user-rights" title="3. User Rights">
              <p>Under GDPR and CCPA regulations, Shopify merchants using LionEx have rights regarding their store and customer data.</p>
              <div className="lionex-rights"><span>Right to Access <strong>Guaranteed</strong></span><span>Right to Erasure (Forgotten) <strong>48h Processing</strong></span><span>Data Portability <strong>CSV Export</strong></span></div>
              <button type="button">Request a Data Audit Report <Icon>chevron_right</Icon></button>
            </PolicySection>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function PolicySection({ id, title, children }) {
  return <section className="lionex-policy-section" id={id}><header><h3>{title}</h3></header><main>{children}</main></section>;
}
