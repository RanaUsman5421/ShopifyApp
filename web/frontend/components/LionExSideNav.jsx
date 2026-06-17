import { Link, useLocation } from "react-router-dom";

const navItems = [
  { icon: "home", label: "Home", path: "/" },
  { icon: "package_2", label: "Orders", path: "/orders" },
  { icon: "inventory_2", label: "Link Store", path: "/linkStore" },
  { icon: "sync", label: "Sync Status", path: "/syncStatus" },
  { icon: "settings", label: "Configuration", path: "/configuration" },
  { icon: "policy", label: "Privacy Policy", path: "/privacyPolicy" },
];

function MaterialIcon({ children }) {
  return <span className="material-symbols-outlined">{children}</span>;
}

export default function LionExSideNav({ activeLabel }) {
  const location = useLocation();

  return (
    <nav className="lionex-core-sidebar" aria-label="LionEx navigation">
      <div className="lionex-core-sidebar__brand">
        <h1>LionEx Courier</h1>
        <p>AI Powered Courier</p>
      </div>
      <div className="lionex-core-sidebar__links">
        {navItems.map((item) => {
          const isActive =
            activeLabel === item.label ||
            (item.path !== "/" && location.pathname.toLowerCase() === item.path.toLowerCase());

          return (
            <Link
              className={`lionex-core-sidebar__link${isActive ? " lionex-core-sidebar__link--active" : ""}`}
              key={item.label}
              to={`${item.path}${location.search}`}
            >
              <MaterialIcon>{item.icon}</MaterialIcon>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="lionex-core-sidebar__account">
        <div>LX</div>
        <section>
          <p>Merchant Hub</p>
          <span>Admin Access</span>
        </section>
      </div>
    </nav>
  );
}
