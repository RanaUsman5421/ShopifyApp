export default function OrdersTable({
  orders,
  filters,
  setFilters,
  selectedOrders,
  toggleOrderSelection,
  toggleAllOrders,
}) {
  const filterTabs = ["All", "Unfulfilled", "Fullfilled", "Errored", "New"];

  const getPaymentStatusBadge = (status) => {
    const statusConfig = {
      Paid: {
        bg: "bg-secondary-container",
        text: "text-on-secondary-container",
      },
      Pending: {
        bg: "bg-tertiary-fixed",
        text: "text-on-tertiary-fixed-variant",
      },
      Unpaid: {
        bg: "bg-error-container",
        text: "text-on-error-container",
      },
    };
    return statusConfig[status] || statusConfig.Pending;
  };

  const getFulfillmentStatusBadge = (status) => {
    const statusConfig = {
      Unfulfilled: {
        bg: "bg-surface-container-highest",
        text: "text-on-surface-variant",
      },
      Fulfilled: {
        bg: "bg-primary-container/20",
        text: "text-primary-container",
      },
      Partial: {
        bg: "bg-secondary-fixed",
        text: "text-on-secondary-container",
      },
    };
    return statusConfig[status] || statusConfig.Unfulfilled;
  };

  return (
    <>
      {/* Tabs / Filters Bar */}
      <div className="px-space-4 border-b border-outline-variant bg-surface-container-lowest flex items-center justify-between">
        <div className="flex overflow-x-auto">
          {filterTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setFilters(tab)}
              className={`px-4 py-3 text-label-md transition-colors ${
                filters === tab
                  ? "tab-active border-b-2 border-primary text-primary font-semibold"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pr-2">
          <button className="p-2 text-on-surface-variant hover:bg-surface-container-low rounded-lg">
            <span className="material-symbols-outlined" data-icon="filter_list">
              filter_list
            </span>
          </button>
          <button className="p-2 text-on-surface-variant hover:bg-surface-container-low rounded-lg">
            <span className="material-symbols-outlined" data-icon="swap_vert">
              swap_vert
            </span>
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr>
              <th className="p-space-4 w-12">
                <input
                  type="checkbox"
                  className="rounded border-outline-variant text-primary focus:ring-primary h-4 w-4"
                  checked={selectedOrders.size === orders.length && orders.length > 0}
                  onChange={toggleAllOrders}
                />
              </th>
              <th className="p-space-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Order
              </th>
              <th className="p-space-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Date
              </th>
              <th className="p-space-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Customer
              </th>
              <th className="p-space-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Fulfillment status
              </th>
              <th className="p-space-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Items
              </th>
              <th className="p-space-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/30">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-surface-container-low transition-colors group">
                <td className="p-space-4">
                  <input
                    type="checkbox"
                    className="rounded border-outline-variant text-primary focus:ring-primary h-4 w-4"
                    checked={selectedOrders.has(order.id)}
                    onChange={() => toggleOrderSelection(order.id)}
                  />
                </td>
                <td className="p-space-4 font-label-md text-label-md text-primary font-semibold">
                  {order.id}
                </td>
                <td className="p-space-4 font-body-md text-body-md text-on-surface-variant">
                  {order.date}
                </td>
                <td className="p-space-4 font-body-md text-body-md text-on-surface">
                  {order.customer}
                </td>
                <td className="p-space-4">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full ${getFulfillmentStatusBadge(
                      order.fulfillmentStatus
                    ).bg} ${getFulfillmentStatusBadge(order.fulfillmentStatus).text} font-label-sm text-label-sm`}
                  >
                    {order.fulfillmentStatus}
                  </span>
                </td>
                <td className="p-space-4 font-body-md text-body-md text-on-surface-variant">
                  {order.items}
                </td>
                <td className="p-space-4 font-label-md text-label-md text-right font-semibold">
                  {order.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-space-6 py-space-4 bg-surface-container-low border-t border-outline-variant flex justify-between items-center">
        <p className="font-label-sm text-label-sm text-on-surface-variant">
          Showing 10 of 1,284 orders
        </p>
        <div className="flex gap-space-2">
          <button className="px-3 py-1 border border-outline-variant rounded bg-surface-container-lowest text-on-surface-variant cursor-not-allowed">
            <span className="material-symbols-outlined text-[18px]" data-icon="chevron_left">
              chevron_left
            </span>
          </button>
          <button className="px-3 py-1 border border-outline-variant rounded bg-surface hover:bg-surface-container-highest transition-colors">
            <span className="material-symbols-outlined text-[18px]" data-icon="chevron_right">
              chevron_right
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
