export const ORDER_SYNC_COMPLETED_EVENT = "lionex-order-sync-completed";

export function notifyOrderSyncCompleted(syncStatus) {
  if (!syncStatus || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(ORDER_SYNC_COMPLETED_EVENT, {
      detail: syncStatus,
    })
  );
}

export async function triggerOrderSync(authenticatedFetch) {
  const response = await authenticatedFetch("/api/orders/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const data = await response.json().catch(() => null);

  if (response.status === 409 && data?.data?.status) {
    notifyOrderSyncCompleted(data.data.status);
    throw new Error(data?.error || "Order sync is already in progress.");
  }

  if (!response.ok || !data || data.success === false) {
    throw new Error(data?.error || data?.message || "Failed to sync orders.");
  }

  if (!data?.data?.status) {
    throw new Error("Sync completed but no status was returned.");
  }

  notifyOrderSyncCompleted(data.data.status);

  return data;
}
