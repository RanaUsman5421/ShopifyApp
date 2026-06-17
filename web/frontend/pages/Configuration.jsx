import { useState } from "react";
import "../App.css";
import Footer from "../components/Footer";

import LionExSideNav from "../components/LionExSideNav";
import LionExTopBar from "../components/LionExTopBar";

function Icon({ children, className = "" }) {
  return <span className={`material-symbols-outlined ${className}`}>{children}</span>;
}


export default function Configuration() {
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
