// @ts-nocheck
import { ObjectId } from "mongodb";

import { ORDERS_COLLECTION } from "./config.js";
import { connectToMongoDB } from "./connection.js";

function mapOrderForMongo(order) {
  const address =
    order.shipping_address ||
    order.billing_address ||
    order.customer?.default_address ||
    {};

  return {
    shopifyOrderId: Number(order.id),
    adminGraphqlApiId: order.admin_graphql_api_id || null,
    orderName: order.name || null,
    orderNumber: order.order_number ?? null,
    customerName:
      address.name ||
      [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ||
      null,
    email: order.email || order.contact_email || order.customer?.email || null,
    phone: order.phone || address.phone || order.customer?.phone || null,
    address: {
      address1: address.address1 || null,
      address2: address.address2 || null,
      city: address.city || null,
      province: address.province || null,
      zip: address.zip || null,
      country: address.country || null,
      countryCode: address.country_code || null,
      provinceCode: address.province_code || null,
    },
    financialStatus: order.financial_status || null,
    fulfillmentStatus: order.fulfillment_status || null,
    itemCount: order.item_count ?? null,
    totalPrice: order.total_price || null,
    currency: order.currency || null,
    createdAt: order.created_at ? new Date(order.created_at) : null,
    updatedAt: order.updated_at ? new Date(order.updated_at) : null,
  };
}

function normalizeStoreIdentity(storeIdentity) {
  if (typeof storeIdentity === "string") {
    return {
      storeName: storeIdentity.trim(),
      shopDomain: "",
    };
  }

  const rawStoreName = String(storeIdentity?.storeName || "").trim();
  const rawShopDomain = String(storeIdentity?.shopDomain || "").trim().toLowerCase();
  let storeName = rawStoreName || "";

  if (!storeName && rawShopDomain) {
    storeName = rawShopDomain.replace(/\.myshopify\.com$/i, "");
  }

  if (storeName.toLowerCase().endsWith(".myshopify.com")) {
    storeName = storeName.replace(/\.myshopify\.com$/i, "");
  }

  return {
    storeName,
    shopDomain: rawShopDomain,
  };
}

function emptySaveResult() {
  return { savedCount: 0, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
}

const ORDER_INDEXES = [
  {
    key: { shopDomain: 1, shopifyOrderId: 1 },
    name: "shopDomain_1_shopifyOrderId_1",
    unique: true,
    partialFilterExpression: {
      shopDomain: { $type: "string" },
      shopifyOrderId: { $type: "number" },
    },
  },
  {
    key: { storeId: 1, shopifyOrderId: 1 },
    name: "storeId_1_shopifyOrderId_1",
    unique: true,
    partialFilterExpression: {
      storeId: { $type: "objectId" },
      shopifyOrderId: { $type: "number" },
    },
  },
  { key: { storeId: 1, createdAt: -1 }, name: "storeId_1_createdAt_-1" },
  { key: { shopDomain: 1, createdAt: -1 }, name: "shopDomain_1_createdAt_-1" },
];

function comparableIndexSpec(index) {
  return JSON.stringify({
    key: index.key,
    unique: Boolean(index.unique),
    partialFilterExpression: index.partialFilterExpression || null,
  });
}

function getStoreLookupFilters(storeName, shopDomain) {
  const filters = [];

  if (shopDomain) {
    filters.push({ shopDomain });
  }

  if (storeName) {
    filters.push({ storeName });
  }

  return filters;
}

async function findStoreDocument(db, storeName, shopDomain) {
  const filters = getStoreLookupFilters(storeName, shopDomain);

  if (filters.length === 0) {
    return null;
  }

  return db.collection("stores").findOne(filters.length === 1 ? filters[0] : { $or: filters });
}

async function ensureOrderIndexes(collection) {
  const existingIndexes = await collection.indexes();
  const existingByName = new Map(existingIndexes.map((index) => [index.name, index]));

  for (const index of ORDER_INDEXES) {
    const existingIndex = existingByName.get(index.name);

    if (existingIndex && comparableIndexSpec(existingIndex) !== comparableIndexSpec(index)) {
      await collection.dropIndex(index.name);
    }
  }

  await collection.createIndexes(ORDER_INDEXES);
}

function buildOrderFilter(order, store, normalizedShopDomain, normalizedStoreName) {
  if (store?._id) {
    const filters = [{ storeId: store._id, shopifyOrderId: order.shopifyOrderId }];

    if (normalizedShopDomain) {
      filters.push({ shopDomain: normalizedShopDomain, shopifyOrderId: order.shopifyOrderId });
    }

    if (normalizedStoreName) {
      filters.push({ storeName: normalizedStoreName, shopifyOrderId: order.shopifyOrderId });
    }

    return { $or: filters };
  }

  if (normalizedShopDomain) {
    return { shopDomain: normalizedShopDomain, shopifyOrderId: order.shopifyOrderId };
  }

  return { storeName: normalizedStoreName, shopifyOrderId: order.shopifyOrderId };
}

export async function saveOrdersToMongoDB(orders, storeIdentity) {
  const { storeName: normalizedStoreName, shopDomain: normalizedShopDomain } =
    normalizeStoreIdentity(storeIdentity);

  if (!normalizedStoreName) {
    throw new Error("A valid store name is required to save orders.");
  }

  if (!Array.isArray(orders) || orders.length === 0) {
    return emptySaveResult();
  }

  const mappedOrders = orders
    .filter((order) => order?.id && Number.isFinite(Number(order.id)))
    .map((order) => mapOrderForMongo(order));

  if (mappedOrders.length === 0) {
    return emptySaveResult();
  }

  const db = await connectToMongoDB();
  const collection = db.collection(ORDERS_COLLECTION);
  const store = await findStoreDocument(db, normalizedStoreName, normalizedShopDomain);
  const now = new Date();

  await ensureOrderIndexes(collection);

  const result = await collection.bulkWrite(
    mappedOrders.map((order) => ({
      updateOne: {
        filter: buildOrderFilter(order, store, normalizedShopDomain, normalizedStoreName),
        update: {
          $set: {
            ...order,
            storeId: store?._id || null,
            dashboardUserId: store?.dashboardUserId || null,
            storeName: normalizedStoreName,
            ...(normalizedShopDomain ? { shopDomain: normalizedShopDomain } : {}),
            syncedAt: now,
          },
          $setOnInsert: {
            insertedAt: now,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  return {
    savedCount: mappedOrders.length,
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0,
    upsertedCount: result.upsertedCount || 0,
  };
}

export async function getStoreOrdersFromMongoDB(storeName) {
  if (!storeName || typeof storeName !== "string") {
    throw new Error("A valid store name is required to fetch orders.");
  }

  const normalizedStoreName = storeName.trim();

  if (!normalizedStoreName) {
    throw new Error("A valid store name is required to fetch orders.");
  }

  const normalizedLower = normalizedStoreName.toLowerCase();
  const storeHandle = normalizedLower.replace(/\.myshopify\.com$/i, "");
  const shopDomainCandidates = [normalizedLower];

  if (!normalizedLower.endsWith(".myshopify.com") && storeHandle) {
    shopDomainCandidates.push(`${storeHandle}.myshopify.com`);
  }

  const storeNameCandidates = [normalizedStoreName];
  if (storeHandle && storeHandle !== normalizedStoreName) {
    storeNameCandidates.push(storeHandle);
  }

  const db = await connectToMongoDB();
  const collection = db.collection(ORDERS_COLLECTION);
  const store = await db.collection("stores").findOne({
    $or: [
      { storeName: { $in: storeNameCandidates } },
      { shopDomain: { $in: shopDomainCandidates } },
    ],
  });
  const filters = [];

  if (store?._id instanceof ObjectId) {
    filters.push({ storeId: store._id });
  }

  filters.push(
    { storeName: { $in: storeNameCandidates } },
    { shopDomain: { $in: shopDomainCandidates } }
  );

  const query = { $or: filters };
  const orders = await collection
    .find({ ...query, shopifyOrderId: { $exists: true } })
    .sort({ createdAt: -1, orderNumber: -1 })
    .toArray();

  if (orders.length > 0) {
    return {
      storeName: store?.storeName || orders[0].storeName || normalizedStoreName,
      shopDomain: store?.shopDomain || orders[0].shopDomain || null,
      storeId: store?._id || orders[0].storeId || null,
      orders,
    };
  }

  const legacyRecord = await collection.findOne({ ...query, orders: { $type: "array" } });

  if (legacyRecord) {
    return legacyRecord;
  }

  return null;
}
