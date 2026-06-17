// @ts-nocheck
import { ORDERS_COLLECTION } from "./config.js";
import { connectToMongoDB } from "./connection.js";

// @ts-ignore
function mapOrderForMongo(order) {
  const address =
    order.shipping_address ||
    order.billing_address ||
    order.customer?.default_address ||
    {};

  return {
    shopifyOrderId: order.id,
    adminGraphqlApiId: order.admin_graphql_api_id,
    orderName: order.name,
    orderNumber: order.order_number,
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
    createdAt: order.created_at || null,
    updatedAt: order.updated_at || null,
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

// @ts-ignore
export async function saveOrdersToMongoDB(orders, storeIdentity) {
  const { storeName: normalizedStoreName, shopDomain: normalizedShopDomain } =
    normalizeStoreIdentity(storeIdentity);

  if (!normalizedStoreName) {
    throw new Error("A valid store name is required to save orders.");
  }

  if (!Array.isArray(orders) || orders.length === 0) {
    return emptySaveResult();
  }

  const db = await connectToMongoDB();
  const collection = db.collection(ORDERS_COLLECTION);

  const mappedOrders = orders
    .filter((order) => order?.id)
    .map((order) => mapOrderForMongo(order));

  if (mappedOrders.length === 0) {
    return emptySaveResult();
  }

  const filters = [{ storeName: normalizedStoreName }];

  if (normalizedShopDomain) {
    filters.unshift({ shopDomain: normalizedShopDomain });
  }

  const existingStore = await collection.findOne(filters.length === 1 ? filters[0] : { $or: filters });
  const existingOrders = Array.isArray(existingStore?.orders) ? existingStore.orders : [];
  const existingOrdersById = new Map(
    existingOrders
      .filter((order) => order?.shopifyOrderId)
      .map((order) => [String(order.shopifyOrderId), order])
  );

  const mergedOrders = mappedOrders.map((order) => {
    const existingOrder = existingOrdersById.get(String(order.shopifyOrderId));

    if (!existingOrder) {
      return order;
    }

    return {
      ...existingOrder,
      ...Object.fromEntries(Object.entries(order).filter(([, value]) => value != null && value !== "")),
    };
  });

  const result = await collection.updateOne(
    existingStore?._id ? { _id: existingStore._id } : filters.length === 1 ? filters[0] : { $or: filters },
    {
      $set: {
        storeName: normalizedStoreName,
        ...(normalizedShopDomain ? { shopDomain: normalizedShopDomain } : {}),
        orders: mergedOrders,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        settings: {
          defaultCourier: "M&P",
          defaultWeight: "0.5",
          orderBooking: "Manual",
        },
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return {
    savedCount: mergedOrders.length,
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0,
    upsertedCount: result.upsertedCount || 0,
  };
}

// @ts-ignore
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

  return collection.findOne({
    $or: [
      { storeName: { $in: storeNameCandidates } },
      { shopDomain: { $in: shopDomainCandidates } },
    ],
  });
}
