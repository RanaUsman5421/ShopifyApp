import "../App.css";
import Footer from "../components/Footer";
import LionExSideNav from "../components/LionExSideNav";
import LionExTopBar from "../components/LionExTopBar";

function Icon({ children, className = "" }) {
  return <span className={`material-symbols-outlined ${className}`}>{children}</span>;
}


function PolicySection({ id, title, children }) {
  return <section className="lionex-policy-section" id={id}><header><h3>{title}</h3></header><main>{children}</main></section>;
}

export default function PrivacyPolicy() {
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
