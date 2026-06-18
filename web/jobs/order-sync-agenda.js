import { Agenda } from "agenda";
import { MongoBackend } from "@agendajs/mongo-backend";

import {
  AGENDA_JOBS_COLLECTION,
  DB_NAME,
  DB_URL,
  INSTALLED_SHOPS_COLLECTION,
} from "../database/config.js";
import { connectToMongoDB } from "../database/connection.js";
import { saveOrdersToMongoDB } from "../database/orders.js";
import shopify, { sessionStorage } from "../shopify.js";
import { ensureUsableSession } from "../shopify-session.js";

export const ORDER_SYNC_JOB_NAME = "sync installed shop orders";
export const ORDER_SYNC_INTERVAL = "10 minutes";

let agenda = null;
let agendaStartError = null;
let isSyncRunning = false;
let manualSyncSchedule = {
  lastRunAt: null,
  nextRunAt: null,
};

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || "").trim().toLowerCase();
}

async function getInstalledShopsCollection() {
  const db = await connectToMongoDB();
  return db.collection(INSTALLED_SHOPS_COLLECTION);
}

export async function registerInstalledShop({
  shopDomain,
  storeName,
  accessToken,
  refreshToken,
  expires,
}) {
  const normalizedShopDomain = normalizeShopDomain(shopDomain);

  if (!normalizedShopDomain) {
    return null;
  }

  const collection = await getInstalledShopsCollection();
  const updateFields = {
    shopDomain: normalizedShopDomain,
    ...(storeName ? { storeName } : {}),
    installed: true,
    updatedAt: new Date(),
  };

  if (accessToken) {
    updateFields.accessToken = accessToken;
  }

  if (refreshToken) {
    updateFields.refreshToken = refreshToken;
  }

  if (expires) {
    updateFields.expires = expires instanceof Date ? expires : new Date(expires);
  }

  await collection.updateOne(
    { shopDomain: normalizedShopDomain },
    {
      $set: updateFields,
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return normalizedShopDomain;
}

async function getInstalledShops() {
  const collection = await getInstalledShopsCollection();
  return collection.find({ installed: true }).toArray();
}

async function getShopSession(shopDomain) {
  const normalizedShopDomain = normalizeShopDomain(shopDomain);

  if (!normalizedShopDomain) {
    return null;
  }

  const sessions = await sessionStorage.findSessionsByShop(normalizedShopDomain);
  const storedSession = sessions.find((session) => session?.accessToken) || null;

  if (storedSession) {
    return storedSession;
  }

  const collection = await getInstalledShopsCollection();
  const shopRecord = await collection.findOne({
    shopDomain: normalizedShopDomain,
    installed: true,
    accessToken: { $exists: true, $ne: null },
  });

  if (!shopRecord?.accessToken) {
    return null;
  }

  return {
    id: `offline_${normalizedShopDomain}`,
    shop: normalizedShopDomain,
    state: "",
    isOnline: false,
    accessToken: shopRecord.accessToken,
    refreshToken: shopRecord.refreshToken || undefined,
    expires: shopRecord.expires || undefined,
    scope: process.env.SCOPES || "",
  };
}

function getGraphqlClient(session) {
  return new shopify.api.clients.Graphql({ session });
}

async function runShopifyGraphql(session, query) {
  const activeSession = (await ensureUsableSession(session)) || session;
  const client = getGraphqlClient(activeSession);
  const response = await client.request(query);

  return response?.data || {};
}

function mapGraphqlAddress(address) {
  if (!address) {
    return null;
  }

  return {
    name: address.name || null,
    address1: address.address1 || null,
    address2: address.address2 || null,
    city: address.city || null,
    province: address.province || null,
    province_code: address.provinceCode || null,
    zip: address.zip || null,
    country: address.country || null,
    country_code: address.countryCodeV2 || address.countryCode || null,
    phone: address.phone || null,
  };
}

function mapGraphqlOrder(order) {
  const totalPrice = order?.totalPriceSet?.shopMoney;

  return {
    id: order?.legacyResourceId || order?.id,
    admin_graphql_api_id: order?.id || null,
    name: order?.name || null,
    order_number: order?.name ? Number(String(order.name).replace(/\D/g, "")) || null : null,
    email: order?.email || order?.customer?.email || null,
    contact_email: order?.email || order?.customer?.email || null,
    phone: order?.phone || order?.customer?.phone || null,
    customer: order?.customer
      ? {
          first_name: order.customer.firstName || null,
          last_name: order.customer.lastName || null,
          email: order.customer.email || null,
          phone: order.customer.phone || null,
          default_address: mapGraphqlAddress(order.customer.defaultAddress),
        }
      : null,
    shipping_address: mapGraphqlAddress(order?.shippingAddress),
    billing_address: mapGraphqlAddress(order?.billingAddress),
    financial_status: order?.displayFinancialStatus || null,
    fulfillment_status: order?.displayFulfillmentStatus || null,
    item_count: order?.currentSubtotalLineItemsQuantity ?? null,
    total_price: totalPrice?.amount || null,
    currency: totalPrice?.currencyCode || null,
    created_at: order?.createdAt || null,
    updated_at: order?.updatedAt || null,
  };
}

async function fetchShopInfo(session) {
  const data = await runShopifyGraphql(
    session,
    `#graphql
      query ShopInfo {
        shop {
          name
          myshopifyDomain
        }
      }
    `
  );

  return data.shop || null;
}

async function fetchOrders(session) {
  const data = await runShopifyGraphql(
    session,
    `#graphql
      query Orders {
        orders(first: 250, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            legacyResourceId
            name
            email
            phone
            createdAt
            updatedAt
            displayFinancialStatus
            displayFulfillmentStatus
            currentSubtotalLineItemsQuantity
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              firstName
              lastName
              defaultAddress {
                name
                address1
                address2
                city
                province
                provinceCode
                zip
                country
                countryCodeV2
                phone
              }
            }
            shippingAddress {
              name
              address1
              address2
              city
              province
              provinceCode
              zip
              country
              countryCodeV2
              phone
            }
            billingAddress {
              name
              address1
              address2
              city
              province
              provinceCode
              zip
              country
              countryCodeV2
              phone
            }
          }
        }
      }
    `
  );

  return Array.isArray(data.orders?.nodes) ? data.orders.nodes.map(mapGraphqlOrder) : [];
}

async function syncShopOrders(shopRecord) {
  const shopDomain = normalizeShopDomain(shopRecord?.shopDomain);

  if (!shopDomain) {
    console.log("Order sync skipped because shop record has no valid domain.");
    return { shopDomain: "", fetchedCount: 0, savedCount: 0, skipped: true, reason: "invalid_shop_domain" };
  }

  const session = await getShopSession(shopDomain);

  if (!session) {
    console.log(`Order sync skipped for ${shopDomain} because no usable Shopify session was available.`);
    return {
      shopDomain,
      fetchedCount: 0,
      savedCount: 0,
      skipped: true,
      reason: "session_not_available",
    };
  }

  const shop = await fetchShopInfo(session);
  const storeName = shop?.name || shopRecord.storeName || shopDomain;
  const currentShopDomain = normalizeShopDomain(shop?.myshopifyDomain || session.shop || shopDomain);
  const orders = await fetchOrders(session);
  console.log(`Fetched ${orders.length} order(s) for ${currentShopDomain}.`);

  const saveResult = await saveOrdersToMongoDB(orders, {
    storeName,
    shopDomain: currentShopDomain,
  });

  console.log(`Persisted ${saveResult.savedCount || 0} order(s) for ${currentShopDomain}.`);

  await registerInstalledShop({
    shopDomain: currentShopDomain,
    storeName,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || null,
    expires: session.expires || null,
  });

  return {
    shopDomain: currentShopDomain,
    storeName,
    fetchedCount: orders.length,
    savedCount: saveResult.savedCount || 0,
    skipped: false,
  };
}

async function syncInstalledShopOrders() {
  console.log(`Orders saving function triggered at ${new Date().toISOString()}`);
  if (isSyncRunning) {
    console.log("Order sync skipped because the previous run is still active.");
    return;
  }

  isSyncRunning = true;

  try {
    const shops = await getInstalledShops();
    console.log(`Order sync will process ${shops.length} installed shop(s).`);

    if (shops.length === 0) {
      console.log("Order sync found no installed shops to process.");
    }

    const results = [];

    for (const shopRecord of shops) {
      try {
        const result = await syncShopOrders(shopRecord);
        results.push(result);
      } catch (error) {
        console.error(`Order sync failed for ${shopRecord?.shopDomain || "unknown shop"}:`, error);
        results.push({
          shopDomain: shopRecord?.shopDomain || "",
          error: error?.message || "Order sync failed.",
        });
      }
    }

    console.log("Order sync completed.", {
      shops: shops.length,
      savedCount: results.reduce((sum, result) => sum + (result.savedCount || 0), 0),
      skippedCount: results.reduce((sum, result) => sum + (result?.skipped ? 1 : 0), 0),
    });
  } finally {
    isSyncRunning = false;
  }
}

export async function startOrderSyncAgenda() {
  if (agenda) {
    return agenda;
  }

  const nextAgenda = new Agenda({
    backend: new MongoBackend({
      address: DB_URL,
      collection: AGENDA_JOBS_COLLECTION,
      options: { dbName: DB_NAME },
    }),
    processEvery: "1 minute",
  });

  nextAgenda.define(ORDER_SYNC_JOB_NAME, syncInstalledShopOrders, {
    lockLifetime: 9 * 60 * 1000,
  });

  try {
    await nextAgenda.start();
    await nextAgenda.cancel({ name: ORDER_SYNC_JOB_NAME });
    await nextAgenda.every(ORDER_SYNC_INTERVAL, ORDER_SYNC_JOB_NAME);
  } catch (error) {
    agenda = null;
    agendaStartError = error?.message || "Failed to start order sync scheduler.";
    throw error;
  }

  agenda = nextAgenda;
  agendaStartError = null;
  console.log(`Order sync scheduler started. Runs every ${ORDER_SYNC_INTERVAL}.`);
  return agenda;
}

async function touchOrderSyncJobTimestamps(completedAt = new Date()) {
  const intervalMs = 10 * 60 * 1000;
  const nextRunAt = new Date(completedAt.getTime() + intervalMs);

  manualSyncSchedule = {
    lastRunAt: completedAt,
    nextRunAt,
  };

  if (!agenda) {
    return;
  }

  try {
    const db = await connectToMongoDB();
    await db.collection(AGENDA_JOBS_COLLECTION).updateMany(
      { name: ORDER_SYNC_JOB_NAME },
      {
        $set: {
          lastRunAt: completedAt,
          lastFinishedAt: completedAt,
          nextRunAt,
        },
      }
    );
  } catch (error) {
    console.error("Failed to update order sync schedule after manual sync:", error);
  }
}

export async function triggerOrderSyncForShop(shopDomain) {
  const normalizedShopDomain = normalizeShopDomain(shopDomain);

  if (!normalizedShopDomain) {
    throw new Error("A valid shop domain is required.");
  }

  if (isSyncRunning) {
    return {
      skipped: true,
      reason: "sync_in_progress",
      status: await getOrderSyncStatus(),
    };
  }

  isSyncRunning = true;

  try {
    console.log(`Manual order sync started for ${normalizedShopDomain} at ${new Date().toISOString()}`);
    await registerInstalledShop({ shopDomain: normalizedShopDomain });
    const result = await syncShopOrders({ shopDomain: normalizedShopDomain });
    const completedAt = new Date();
    await touchOrderSyncJobTimestamps(completedAt);

    return {
      skipped: false,
      completedAt: completedAt.toISOString(),
      result,
      status: await getOrderSyncStatus(),
    };
  } finally {
    isSyncRunning = false;
  }
}

function resolveSyncSchedule(job) {
  const jobLastRunAt = job?.lastRunAt ? new Date(job.lastRunAt) : null;
  const jobNextRunAt = job?.nextRunAt ? new Date(job.nextRunAt) : null;
  const manualLastRunAt = manualSyncSchedule.lastRunAt;
  const manualNextRunAt = manualSyncSchedule.nextRunAt;

  if (manualLastRunAt && (!jobLastRunAt || manualLastRunAt >= jobLastRunAt)) {
    return {
      lastRunAt: manualLastRunAt,
      nextRunAt: manualNextRunAt || jobNextRunAt,
    };
  }

  return {
    lastRunAt: jobLastRunAt,
    nextRunAt: jobNextRunAt,
  };
}

export async function getOrderSyncStatus() {
  if (!agenda) {
    return {
      running: false,
      intervalMs: 10 * 60 * 1000,
      nextRunAt: manualSyncSchedule.nextRunAt,
      lastRunAt: manualSyncSchedule.lastRunAt,
      isSyncRunning,
      error: agendaStartError,
    };
  }

  let job = null;

  try {
    const jobsResult = await agenda.queryJobs({
      name: ORDER_SYNC_JOB_NAME,
      sort: { nextRunAt: "asc" },
      limit: 10,
    });
    const jobs = Array.isArray(jobsResult?.jobs) ? jobsResult.jobs : [];
    job = jobs.find((currentJob) => currentJob?.nextRunAt) || jobs[0] || null;
  } catch (error) {
    return {
      running: false,
      intervalMs: 10 * 60 * 1000,
      nextRunAt: manualSyncSchedule.nextRunAt,
      lastRunAt: manualSyncSchedule.lastRunAt,
      isSyncRunning,
      error: error?.message || "Failed to fetch order sync status.",
    };
  }

  const schedule = resolveSyncSchedule(job);

  return {
    running: true,
    intervalMs: 10 * 60 * 1000,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    isSyncRunning,
  };
}
