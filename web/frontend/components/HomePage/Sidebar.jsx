export default function Sidebar() {
  const navItems = [
    { icon: "home", label: "Home", active: false },
    { icon: "package_2", label: "Orders", active: true },
    { icon: "inventory_2", label: "Link Store", active: false },
    { icon: "sync", label: "Sync Status", active: false },
    { icon: "settings", label: "Configuration", active: false },
  ];

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 bg-surface-container-low border-r border-outline-variant flex flex-col py-space-4 z-50">
      {/* Header */}
      <div className="px-space-6 mb-space-8">
        <h1 className="font-headline-md text-headline-md font-bold text-primary">LionEx</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">Logistics Management</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <a
            key={item.label}
            href="#"
            className={`flex items-center px-space-6 py-space-3 mx-space-2 rounded-lg transition-colors cursor-pointer ${
              item.active
                ? "bg-secondary-container text-on-secondary-container font-semibold"
                : "text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            <span className="material-symbols-outlined mr-space-3" data-icon={item.icon}>
              {item.icon}
            </span>
            <span className="font-body-md text-body-md">{item.label}</span>
          </a>
        ))}
      </nav>

      {/* User Profile */}
      <div className="px-space-6 py-space-4 border-t border-outline-variant">
        <div className="flex items-center">
          <img
            alt="LionEx Logo"
            className="w-8 h-8 rounded-full mr-space-3"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDnd2Tz_363hqGX3Agr0hv45JtxsFRO5G_dthJ625QVSyoFLe-0PvykivvUcLt8io4n-CBCi20WmGIuC2jkcRaGaQtfupADEC8eGX15kZaAs3sZbMIk0ugiYLFlLqPXdflHNaMk4n0KAdCByHOC-AHtmag_sm3uote86pMHP5lGMUYjEKh6h8ie0p4PavwPXnHGG0JEaJne1MwviBiPOs6bu9mqyS_VQX2oRZ1LvadMSxQwGcJK92D4dLcIYqicQcEa7RALvKMRq80o"
          />
          <span className="font-label-md text-label-md">Merchant Admin</span>
        </div>
      </div>
    </aside>
  );
}
