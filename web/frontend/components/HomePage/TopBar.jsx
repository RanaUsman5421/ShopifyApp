export default function HomePageTopBar({ searchQuery, setSearchQuery }) {
  return (
    <header className="fixed top-0 right-0 w-[calc(100%-16rem)] h-16 bg-surface border-b border-outline-variant flex justify-between items-center px-space-6 z-40">
      <div className="flex items-center flex-1">
        {/* Search Bar */}
        <div className="relative w-full max-w-md">
          <span
            className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            data-icon="search"
          >
            search
          </span>
          <input
            className="w-full pl-10 pr-4 py-2 bg-surface-container rounded-lg border-none focus:ring-2 focus:ring-primary text-body-md"
            placeholder="Search orders..."
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Bulk Actions */}
        <div className="relative ml-space-3">
          <button className="flex items-center gap-space-2 px-space-4 py-2 bg-surface border border-outline-variant text-on-surface font-label-md text-label-md rounded-lg hover:bg-surface-container transition-all">
            Bulk Actions
            <span className="material-symbols-outlined text-[20px]" data-icon="expand_more">
              expand_more
            </span>
          </button>
        </div>
      </div>

      {/* Right Side Icons */}
      <div className="flex items-center gap-space-4">
        <button className="p-2 hover:bg-surface-container rounded-lg transition-all duration-200">
          <span className="material-symbols-outlined text-on-surface-variant" data-icon="notifications">
            notifications
          </span>
        </button>
        <button className="p-2 hover:bg-surface-container rounded-lg transition-all duration-200">
          <span className="material-symbols-outlined text-on-surface-variant" data-icon="help_outline">
            help_outline
          </span>
        </button>
        <div className="h-8 w-[1px] bg-outline-variant mx-space-2"></div>
        <button className="flex items-center gap-space-2 font-label-md text-label-md text-on-surface hover:bg-surface-container p-2 rounded-lg">
          <span className="material-symbols-outlined" data-icon="settings">
            settings
          </span>
          Merchant Settings
        </button>
      </div>
    </header>
  );
}
