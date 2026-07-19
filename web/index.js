// @ts-check
import "dotenv/config";
import { join } from "path";
import { readFileSync } from "fs";
import crypto from "crypto";

if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = crypto;
}
import http from "http";
import https from "https";
import express from "express";
import serveStatic from "serve-static";

import { DB_NAME, ORDERS_COLLECTION } from "./database/config.js";
import {
  connectToMongoDB,
  getMongoConnectionState,
  getMongoErrorMessage,
} from "./database/connection.js";
import { getStoreOrdersFromMongoDB, saveOrdersToMongoDB } from "./database/orders.js";
import externalOrdersRouter from "./external-orders.js";
import {
  getOrderSyncStatus,
  registerInstalledShop,
  startOrderSyncAgenda,
  triggerOrderSyncForShop,
} from "./jobs/order-sync-agenda.js";
import { handleExpiringAuthCallback } from "./expiring-auth-callback.js";
import shopify, { sessionStorage } from "./shopify.js";
import { ensureUsableSession, safeValidateAuthenticatedSession } from "./shopify-session.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";



const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "5000",
  10
);

const isProduction = process.env.NODE_ENV === "production";
const STATIC_PATH = isProduction
  ? `${process.cwd()}/frontend/dist/`
  : `${process.cwd()}/frontend/`;
const DEV_FRONTEND_HOST = process.env.HOST
  ? process.env.HOST.replace(/https?:\/\//, "")
  : "localhost";
const DEV_FRONTEND_PORT = process.env.FRONTEND_PORT || "5173";
const DEV_FRONTEND_ORIGIN = `http://${DEV_FRONTEND_HOST}:${DEV_FRONTEND_PORT}`;

const app = express();

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

// Apply JSON parsing middleware early
app.use(express.json());
app.use("/api", attachShopifySession);

function startOrderSyncSchedulerWithRetry() {
  startOrderSyncAgenda().catch((error) => {
    console.error("Failed to start order sync scheduler:", error);

    const retryTimer = setTimeout(startOrderSyncSchedulerWithRetry, 60 * 1000);
    retryTimer.unref?.();
  });
}

connectToMongoDB()
  .then(() => {
    console.log(`MongoDB connected (${DB_NAME}).`);
    startOrderSyncSchedulerWithRetry();
  })
  .catch((error) => {
    console.error("MongoDB connection failed at startup:", getMongoErrorMessage(error));
    startOrderSyncSchedulerWithRetry();
  });

function getDashboardApiUrl() {
  return (process.env.DASHBOARD_API_URL || "http://localhost:5000").replace(/\/$/, "");
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const body = JSON.stringify(payload);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    const request = transport.request(
      {
        method: "POST",
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          let data = null;

          try {
            const trimmedBody = responseBody?.trim();
            data = trimmedBody ? JSON.parse(trimmedBody) : null;
          } catch (error) {
            return reject(new Error("Dashboard backend returned invalid JSON."));
          }

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            data,
          });
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    const request = transport.request(
      {
        method: "GET",
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          let data = null;

          try {
            const trimmedBody = responseBody?.trim();
            data = trimmedBody ? JSON.parse(trimmedBody) : null;
          } catch (error) {
            return reject(new Error("Dashboard backend returned invalid JSON."));
          }

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            data,
          });
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}
function getDashboardResponseError(response) {
  return (
    response?.data?.error ||
    response?.data?.message ||
    response?.data?.data?.error ||
    response?.data?.data?.message ||
    null
  );
}

function hashDashboardToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeStoreKey(value) {
  return String(value || "").trim().toLowerCase();
}

function safeDashboardUser(user) {
  if (!user) {
    return null;
  }

  const safe = {
    ...user,
    _id: user._id?.toString?.() || user._id,
  };

  delete safe.linkTokenHash;
  delete safe.passwordHash;
  delete safe.passwordSalt;

  if (safe.shopify) {
    safe.shopify = { ...safe.shopify };
    delete safe.shopify.accessToken;
  }

  if (Array.isArray(safe.shopifyStores)) {
    safe.shopifyStores = safe.shopifyStores.map((store) => {
      const safeStore = { ...store };
      delete safeStore.accessToken;
      return safeStore;
    });
  }

  return safe;
}

async function linkDashboardUserDirectly({ token, shopDomain, storeName, shopifyAccessToken }) {
  const normalizedShopDomain = normalizeStoreKey(shopDomain);
  const normalizedStoreName = String(storeName || shopDomain || "").trim();

  if (!token?.trim() || !normalizedShopDomain) {
    return {
      ok: false,
      status: 400,
      data: {
        success: false,
        message: "token and shopDomain are required",
      },
    };
  }

  const db = await connectToMongoDB();
  const users = db.collection("DashboardUsers");
  const stores = db.collection("stores");
  const user = await users.findOne({ linkTokenHash: hashDashboardToken(token.trim()) });

  if (!user) {
    return {
      ok: false,
      status: 404,
      data: {
        success: false,
        message: "Invalid token",
      },
    };
  }

  const linkedAt = new Date();
  const linkedStore = {
    shopDomain: normalizedShopDomain,
    storeName: normalizedStoreName || normalizedShopDomain,
    accessToken: String(shopifyAccessToken || "").trim() || null,
    linkedAt,
  };

  await users.updateOne(
    { _id: user._id },
    {
      $pull: {
        shopifyStores: {
          shopDomain: normalizedShopDomain,
        },
      },
    }
  );

  await users.updateOne(
    { _id: user._id },
    {
      $set: {
        shopify: {
          connected: true,
          ...linkedStore,
        },
        tokenUsedAt: linkedAt,
        updatedAt: linkedAt,
      },
      $push: {
        shopifyStores: linkedStore,
      },
    }
  );

  await stores.updateOne(
    {
      $or: [
        { shopDomain: normalizedShopDomain },
        { storeName: linkedStore.storeName },
      ],
    },
    {
      $set: {
        shopDomain: normalizedShopDomain,
        storeName: linkedStore.storeName,
        dashboardUserId: user._id,
        "ShopifyStoreSettings.username": user.username || null,
        updatedAt: linkedAt,
      },
      $setOnInsert: {
        "ShopifyStoreSettings.defaultCourier": "M&P",
        "ShopifyStoreSettings.defaultWeight": "0.5",
        "ShopifyStoreSettings.orderBooking": "Manual",
        createdAt: linkedAt,
      },
    },
    { upsert: true }
  );

  const updatedUser = await users.findOne({ _id: user._id });
  const safeUser = safeDashboardUser(updatedUser);
  const safeStores = Array.isArray(safeUser?.shopifyStores) ? safeUser.shopifyStores : [];

  return {
    ok: true,
    status: 200,
    data: {
      success: true,
      message: "Shopify store linked successfully",
      data: safeUser,
      stores: safeStores,
      store: safeStores.find((store) => normalizeStoreKey(store.shopDomain) === normalizedShopDomain) || {
        shopDomain: normalizedShopDomain,
        storeName: linkedStore.storeName,
        linkedAt,
      },
      source: "direct-mongodb",
    },
  };
}

async function linkDashboardUserWithFallback(payload) {
  try {
    const response = await postJson(`${getDashboardApiUrl()}/api/link-token`, payload);

    if (response.ok && response.data?.success) {
      return response;
    }

    if (response.status && response.status < 500) {
      return response;
    }

    console.error("Dashboard API link failed, attempting direct MongoDB fallback:", response);
  } catch (error) {
    console.error("Dashboard API link request failed, attempting direct MongoDB fallback:", error);
  }

  return linkDashboardUserDirectly(payload);
}

function getResponseCount(response) {
  if (typeof response?.count === "number") {
    return response.count;
  }

  if (typeof response?.data?.count === "number") {
    return response.data.count;
  }

  return 0;
}

function getShopFromUrlValue(urlValue) {
  if (!urlValue) {
    return "";
  }

  try {
    const parsedUrl = new URL(urlValue, "https://example.com");
    const shop = parsedUrl.searchParams.get("shop");

    if (shop) {
      return shop;
    }

    const host = parsedUrl.searchParams.get("host");

    if (!host) {
      return "";
    }

    const normalizedHost = host.replace(/-/g, "+").replace(/_/g, "/");
    const paddedHost = normalizedHost.padEnd(Math.ceil(normalizedHost.length / 4) * 4, "=");
    const decodedHost = Buffer.from(paddedHost, "base64").toString("utf8");
    const storeHandle = decodedHost.match(/\/store\/([^/?]+)/)?.[1];

    return storeHandle ? `${storeHandle}.myshopify.com` : "";
  } catch (error) {
    return "";
  }
}

function getRequestShop(req) {
  return (
    getShopFromUrlValue(req.originalUrl) ||
    getShopFromUrlValue(req.get("referer")) ||
    getShopFromUrlValue(req.get("referrer"))
  );
}

function normalizeShopDomain(shopDomain) {
  return String(shopDomain || "").trim().toLowerCase();
}

async function getStoredSessionForShop(shopDomain) {
  const normalizedShopDomain = normalizeShopDomain(shopDomain);

  if (!normalizedShopDomain) {
    return null;
  }

  const sessions = await sessionStorage.findSessionsByShop(normalizedShopDomain);

  return sessions.find((session) => session?.accessToken) || null;
}

function registerShopFromSession(session, storeName) {
  registerInstalledShop({
    shopDomain: session.shop,
    storeName: storeName || null,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || null,
    expires: session.expires || null,
  }).catch((error) => {
    console.error("Failed to register installed shop:", error);
  });
}

async function attachSessionToRequest(req, res, session) {
  if (!session?.accessToken) {
    return false;
  }

  try {
    const usableSession = await ensureUsableSession(session);
    const activeSession = usableSession || session;

    res.locals.shopify = {
      ...(res.locals.shopify || {}),
      session: activeSession,
    };

    registerShopFromSession(activeSession);
    return true;
  } catch (error) {
    console.error("Failed to prepare Shopify session:", error);
    res.locals.shopify = {
      ...(res.locals.shopify || {}),
      session,
    };
    registerShopFromSession(session);
    return true;
  }
}

async function attachShopifySession(req, res, next) {
  if (res.locals?.shopify?.session) {
    return next();
  }

  try {
    const sessionId = await shopify.api.session.getCurrentId({
      isOnline: shopify.config.useOnlineTokens,
      rawRequest: req,
      rawResponse: res,
    });

    if (sessionId) {
      const session = await sessionStorage.loadSession(sessionId);

      if (await attachSessionToRequest(req, res, session)) {
        return next();
      }
    }
  } catch (error) {
    const message = error?.message || String(error);
    const isExpectedMissingToken =
      error?.name === "InvalidJwtError" ||
      message.includes("session token") ||
      message.includes("Session not found");

    if (!isExpectedMissingToken) {
      console.error("Failed to resolve Shopify session from token:", error);
    }
  }

  let requestShop = getRequestShop(req);

  if (!requestShop) {
    const bearerMatch = req.headers.authorization?.match(/Bearer (.+)/);

    if (bearerMatch?.[1]) {
      try {
        const payload = await shopify.api.session.decodeSessionToken(bearerMatch[1]);
        requestShop = payload.dest?.replace(/^https:\/\//, "").replace(/\/.*$/, "") || "";
      } catch (error) {
        console.error("Failed to decode Shopify session token:", error);
      }
    }
  }

  try {
    const session = await getStoredSessionForShop(requestShop);

    if (session) {
      await attachSessionToRequest(req, res, session);
    }
  } catch (error) {
    console.error("Failed to restore Shopify session from storage:", error);
  }

  return next();
}

function getGraphqlClient(session) {
  return new shopify.api.clients.Graphql({ session });
}

async function runShopifyGraphql(session, query, variables = {}) {
  const activeSession = (await ensureUsableSession(session)) || session;
  const client = getGraphqlClient(activeSession);
  const response = await client.request(query, { variables });

  if (response?.errors && Array.isArray(response.errors) && response.errors.length > 0) {
    console.error("GraphQL Errors:", response.errors);
    throw new Error(`GraphQL Error: ${response.errors.map(e => e.message).join(", ")}`);
  }

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

function normalizeGraphqlWeight(weight) {
  const value = weight?.value ?? weight?.weight ?? null;
  const numericValue = Number(value);

  return {
    weight: Number.isFinite(numericValue) ? numericValue : null,
    weightUnit: weight?.unit || weight?.weightUnit || null,
  };
}
function mapGraphqlOrder(order) {
  const totalPrice = order?.totalPriceSet?.shopMoney;

  // Safely extract lineItems with weight information
  const lineItems = Array.isArray(order?.lineItems?.nodes)
    ? order.lineItems.nodes.map((item) => {
        const itemWeight = normalizeGraphqlWeight(item?.weight);

        return {
          id: item?.id || null,
          title: item?.title || null,
          quantity: item?.quantity || 0,
          weight: itemWeight.weight,
          weightUnit: itemWeight.weightUnit || "kg",
          variant: item?.variant
            ? {
                id: item.variant.id || null,
                sku: item.variant.sku || item?.sku || null,
                title: item.variant.title || item?.variantTitle || null,
                weight: itemWeight.weight,
                weightUnit: itemWeight.weightUnit || "kg",
              }
            : null,
        };
      })
    : [];

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
    lineItems: lineItems,
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

function getStoreDisplayName(storeInfo) {
  const rawName = String(storeInfo?.name || "").trim();
  const shopDomain = String(storeInfo?.myshopifyDomain || "").trim();

  if (rawName && !rawName.toLowerCase().endsWith(".myshopify.com")) {
    return rawName;
  }

  if (shopDomain) {
    return shopDomain.replace(/\.myshopify\.com$/i, "");
  }

  return rawName || shopDomain || "";
}

async function fetchProductsCount(session) {
  const data = await runShopifyGraphql(
    session,
    `#graphql
      query ProductsCount {
        productsCount {
          count
        }
      }
    `
  );

  return data.productsCount?.count || 0;
}

async function fetchOrdersCount(session) {
  const data = await runShopifyGraphql(
    session,
    `#graphql
      query OrdersCount {
        ordersCount {
          count
        }
      }
    `
  );

  return data.ordersCount?.count ?? 0;
}

async function fetchOrders(session) {
  try {
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
              lineItems(first: 250) {
                nodes {
                  id
                  title
                  sku
                  quantity
                  variantTitle
                  weight {
                    value
                    unit
                  }
                  variant {
                    id
                    sku
                    title
                  }
                }
              }
            }
          }
        }
      `
    );

    console.log("📊 GraphQL Orders Response Data:", data);

    if (!data?.orders?.nodes) {
      console.warn("⚠️ No orders data in GraphQL response. Trying fallback query without lineItems...");
      return await fetchOrdersFallback(session);
    }

    // Log detailed lineItems inspection
    if (Array.isArray(data.orders.nodes) && data.orders.nodes.length > 0) {
      const firstOrder = data.orders.nodes[0];
      console.log("🔍 First order lineItems structure:", {
        hasLineItems: !!firstOrder.lineItems,
        lineItemsType: typeof firstOrder.lineItems,
        lineItemsValue: firstOrder.lineItems,
        hasNodes: !!firstOrder.lineItems?.nodes,
        nodesLength: firstOrder.lineItems?.nodes?.length || 0,
      });
      
      if (firstOrder.currentSubtotalLineItemsQuantity > 0 && (!firstOrder.lineItems?.nodes || firstOrder.lineItems.nodes.length === 0)) {
        console.warn("⚠️ WARNING: Order has items (quantity:", firstOrder.currentSubtotalLineItemsQuantity, ") but lineItems.nodes is empty!");
        console.log("📌 This may indicate a Shopify API permission issue or data access restriction");
      }
    }

    const mappedOrders = Array.isArray(data.orders.nodes) ? data.orders.nodes.map(mapGraphqlOrder) : [];
    console.log("✅ Successfully mapped orders:", mappedOrders.length, "orders");
    return mappedOrders;
  } catch (error) {
    console.error("❌ Error in fetchOrders:", error?.message || error);
    console.log("📌 Attempting fallback query...");
    try {
      return await fetchOrdersFallback(session);
    } catch (fallbackError) {
      console.error("❌ Fallback query also failed:", fallbackError?.message || fallbackError);
      throw fallbackError;
    }
  }
}

async function fetchOrdersFallback(session) {
  console.log("🔄 Using fallback query (without lineItems)...");
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

  console.log("📊 Fallback GraphQL Response:", data);

  if (!data?.orders?.nodes) {
    console.warn("⚠️ No orders data even in fallback query");
    return [];
  }

  const mappedOrders = Array.isArray(data.orders.nodes) ? data.orders.nodes.map(mapGraphqlOrder) : [];
  console.log("✅ Successfully mapped orders from fallback:", mappedOrders.length, "orders");
  return mappedOrders;
}

function getShopifyOrdersErrorMessage(error) {
  const message = String(error?.message || error || "").trim();

  if (message.includes("not approved to access the Order object")) {
    return "Shopify order access requires Protected Customer Data approval in the Partner Dashboard.";
  }

  return message || "Failed to fetch orders from Shopify.";
}

// Read the authenticated store identity used by the app UI.
app.get("/api/store/info", safeValidateAuthenticatedSession(), async (_req, res) => {
  try {
    if (!res.locals?.shopify?.session) {
      console.error("Store info: No session found in res.locals.shopify");
      return res.status(401).send({
        success: false,
        error: "No authenticated session found.",
      });
    }

    let shop = null;

    try {
      shop = await fetchShopInfo(res.locals.shopify.session);
    } catch (shopError) {
      console.error("Store info: Shopify query failed, using session fallback:", shopError);
      shop = {
        name: res.locals.shopify.session.shop,
        myshopifyDomain: res.locals.shopify.session.shop,
      };
    }

    if (!shop) {
      console.warn("Store info: Shop data not found.");
      return res.status(404).send({
        success: false,
        error: "Store information was not found.",
      });
    }

    try {
      await registerInstalledShop({
        shopDomain: shop.myshopifyDomain || res.locals.shopify.session.shop,
        storeName: shop.name || null,
        accessToken: res.locals.shopify.session.accessToken,
        refreshToken: res.locals.shopify.session.refreshToken || null,
        expires: res.locals.shopify.session.expires || null,
      });
    } catch (registrationError) {
      console.error("Store info: Failed to register installed shop:", registrationError);
    }

    const rawName = shop.name || res.locals.shopify.session.shop || null;
    const rawDomain = shop.myshopifyDomain || res.locals.shopify.session.shop || null;

    return res.status(200).send({
      success: true,
      data: {
        name: rawName,
        myshopifyDomain: rawDomain,
        displayName: getStoreDisplayName({ name: rawName, myshopifyDomain: rawDomain }),
      },
    });
  } catch (error) {
    console.error("Failed to fetch store info:", error?.message || error, error?.stack);
    return res.status(500).send({
      success: false,
      error: error?.message || "Failed to fetch store information.",
    });
  }
});

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  handleExpiringAuthCallback,
  async (_req, res, next) => {
    try {
      const session = res.locals.shopify?.session;

      if (session?.shop) {
        await registerInstalledShop({
          shopDomain: session.shop,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken || null,
          expires: session.expires || null,
        });
      }
    } catch (error) {
      console.error("Failed to register installed shop:", error);
    }

    next();
  },
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

app.use("/external", externalOrdersRouter);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.get("/api/products/count", async (_req, res) => {
  try {
    if (!res.locals?.shopify?.session) {
      console.error("Product count: No session found");
      return res.status(200).send({ success: true, count: 0, data: { count: 0 } });
    }

    let count = 0;

    try {
      count = await fetchProductsCount(res.locals.shopify.session);
    } catch (shopifyError) {
      console.error("Failed to fetch product count from Shopify:", shopifyError);
    }

    return res.status(200).send({ success: true, count, data: { count } });
  } catch (error) {
    console.error("Failed to fetch product count:", error?.message || error, error?.stack);
    return res.status(500).send({ success: false, error: error?.message || "Failed to fetch product count." });
  }
});

app.post("/api/orders/sync", async (_req, res) => {
  try {
    if (!res.locals?.shopify?.session) {
      console.error("Manual order sync: No session found");
      return res.status(401).send({
        success: false,
        error: "No authenticated session found.",
      });
    }

    let shopDomain = res.locals.shopify.session.shop || "";

    try {
      const shop = await fetchShopInfo(res.locals.shopify.session);
      shopDomain = shop?.myshopifyDomain || shopDomain;
    } catch (shopError) {
      console.error("Order sync: Shopify shop lookup failed, using session fallback:", shopError);
    }

    console.log(`Manual order sync requested for ${shopDomain}`);

    const syncResult = await triggerOrderSyncForShop(shopDomain);

    console.log("Manual order sync completed.", {
      shopDomain,
      savedCount: syncResult?.result?.savedCount ?? 0,
      fetchedCount: syncResult?.result?.fetchedCount ?? 0,
      skipped: Boolean(syncResult?.skipped),
    });

    if (syncResult.skipped) {
      return res.status(409).send({
        success: false,
        error: "Order sync is already in progress.",
        data: syncResult,
      });
    }

    return res.status(200).send({
      success: true,
      data: syncResult,
    });
  } catch (error) {
    console.error("Manual order sync error:", error);
    return res.status(500).send({
      success: false,
      error: error?.message || "Failed to sync orders.",
    });
  }
});

app.get("/api/orders/sync-status", async (_req, res) => {
  try {
    res.status(200).send({
      success: true,
      data: await getOrderSyncStatus(),
    });
  } catch (error) {
    console.error("Order sync status error:", error);
    res.status(200).send({
      success: true,
      data: {
        running: false,
        intervalMs: 10 * 60 * 1000,
        nextRunAt: null,
        lastRunAt: null,
        isSyncRunning: false,
        error: error?.message || "Failed to fetch order sync status.",
      },
    });
  }
});


app.get("/api/v8/track/test-auto-book", async (_req, res) => {
  try {
    const bookingResponse = await getJson(`${getDashboardApiUrl()}/api/v8/track/test-auto-book`);

    return res.status(bookingResponse.status || 200).send(bookingResponse.data || { success: bookingResponse.ok });
  } catch (error) {
    console.error("Book packet proxy error:", error);
    return res.status(500).send({
      success: false,
      error: error?.message || "Failed to book packets.",
    });
  }
});
// reading orders
app.get("/api/orders/all", async (_req, res) => {
  try {
    if (!res.locals?.shopify?.session) {
      console.error("Orders all: No session found");
      return res.status(200).send({ success: true, data: [] });
    }

    let data = [];
    let fetchError = null;
    let count = 0;

    try {
      count = await fetchOrdersCount(res.locals.shopify.session);
      console.log("📦 Orders count from Shopify:", count);
    } catch (countError) {
      console.error("Failed to fetch Shopify orders count:", countError?.message || countError);
    }

    try {
      data = await fetchOrders(res.locals.shopify.session);
      console.log("✅ Fetched orders successfully. Total orders:", data.length);
      if (data.length > 0) {
        console.log("📋 Sample order structure:", JSON.stringify(data[0], null, 2));
      }
    } catch (shopifyError) {
      fetchError = getShopifyOrdersErrorMessage(shopifyError);
      console.error("Failed to fetch orders from Shopify:", shopifyError?.message || shopifyError);
    }

    return res.status(200).send({ success: true, data, count, fetchError });
  } catch (e) {
    console.error("Failed to fetch orders:", e?.message || e, e?.stack);
    return res.status(500).send({ success: false, error: e?.message || "Failed to fetch orders." });
  }
});

app.post("/api/orders/save", async (req, res) => {
  try {
    if (!res.locals?.shopify?.session) {
      return res.status(200).send({
        success: true,
        mongo: {
          connected: getMongoConnectionState().connected,
          database: DB_NAME,
          collection: ORDERS_COLLECTION,
          error: "No authenticated session found.",
        },
        savedCount: 0,
      });
    }

    const orders = req.body?.orders;
    const shop = await fetchShopInfo(res.locals.shopify.session);
    const storeName = shop?.name || res.locals.shopify.session.shop || null;
    const shopDomain = shop?.myshopifyDomain || res.locals.shopify.session.shop || null;

    const result = await saveOrdersToMongoDB(orders, { storeName, shopDomain });

    res.status(200).send({
      success: true,
      mongo: {
        connected: getMongoConnectionState().connected,
        database: DB_NAME,
        collection: ORDERS_COLLECTION,
        error: null,
      },
      ...result,
    });
  } catch (error) {
    console.error("MongoDB save orders error:", error);
    res.status(500).send({
      success: false,
      mongo: {
        connected: false,
        database: DB_NAME,
        collection: ORDERS_COLLECTION,
        error: getMongoErrorMessage(error),
      },
      error: getMongoErrorMessage(error),
    });
  }
});

app.get("/api/dashboard/link-status", async (_req, res) => {
  try {
    if (!res.locals?.shopify?.session) {
      return res.status(200).send({
        success: true,
        linked: false,
      });
    }

    const shopDomain = normalizeShopDomain(res.locals.shopify.session.shop);

    if (!shopDomain) {
      return res.status(200).send({
        success: true,
        linked: false,
      });
    }

    const db = await connectToMongoDB();
    const user = await db.collection("DashboardUsers").findOne({
      $or: [
        { "shopify.shopDomain": shopDomain },
        { shopifyStores: { $elemMatch: { shopDomain } } },
      ],
    });

    return res.status(200).send({
      success: true,
      linked: Boolean(user),
      userName: user?.name || null,
      shopDomain,
    });
  } catch (error) {
    console.error("Dashboard link status error:", error);
    return res.status(200).send({
      success: true,
      linked: false,
      error: error?.message || "Failed to check link status.",
    });
  }
});

app.post(
  "/api/dashboard/link",
  safeValidateAuthenticatedSession(),
  async (req, res) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";

    if (!token) {
      return res.status(400).send({
        success: false,
        error: "A dashboard user token is required.",
      });
    }

    const shop = await fetchShopInfo(res.locals.shopify.session);
    const storeName = shop?.name || res.locals.shopify.session.shop || "";
    const shopDomain = shop?.myshopifyDomain || res.locals.shopify.session.shop || "";

    await registerInstalledShop({
      shopDomain,
      storeName,
      accessToken: res.locals.shopify.session.accessToken,
      refreshToken: res.locals.shopify.session.refreshToken || null,
      expires: res.locals.shopify.session.expires || null,
    });

    const linkResponse = await linkDashboardUserWithFallback({
      token,
      shopDomain,
      storeName,
      shopifyAccessToken: res.locals.shopify.session.accessToken,
    });

    if (!linkResponse.ok || !linkResponse.data?.success) {
      console.error("Dashboard API responded with an error while linking:", linkResponse);

      return res.status(linkResponse.status || 500).send({
        success: false,
        error: getDashboardResponseError(linkResponse) || `Dashboard API error (status ${linkResponse.status})`,
        // include dashboard response body for diagnostics (avoid sending secrets)
        dashboardResponse: linkResponse.data || null,
      });
    }

    return res.status(200).send({
      success: true,
      message: "Dashboard user linked to this Shopify store. Orders will sync on the next scheduled sync.",
      linkedUser: linkResponse.data.data,
      shop: {
        storeName,
        shopDomain,
      },
      orders: {
        fetchedCount: 0,
        savedCount: 0,
        error: null,
        note: "Orders will be persisted during the scheduled Agenda sync.",
      },
    });
  } catch (error) {
    console.error("Dashboard link error:", error);
    return res.status(500).send({
      success: false,
      error: error?.message || "Failed to link dashboard user",
    });
  }
});

app.get("/api/dashboard/store-settings", async (req, res) => {
  try {
    const shopDomain = normalizeShopDomain(
      typeof req.query?.shopDomain === "string" ? req.query.shopDomain.trim() : ""
    );

    if (!shopDomain) {
      return res.status(400).send({
        success: false,
        error: "shopDomain query parameter is required.",
      });
    }

    const db = await connectToMongoDB();
    const store = await db.collection("stores").findOne({ shopDomain });

    if (!store) {
      return res.status(200).send({
        success: true,
        settings: {
          defaultCourier: "M&P",
          defaultWeight: "0.5",
          orderBooking: "Auto",
          defaultService: "Overnight",
        },
      });
    }

    // Check both field names for backward compatibility
    const storeSettings = store.ShopifyStoreSettings || store.settings || {};

    return res.status(200).send({
      success: true,
      settings: {
        defaultCourier: storeSettings.defaultCourier || "M&P",
        defaultWeight: storeSettings.defaultWeight || "0.5",
        orderBooking: storeSettings.orderBooking || "Auto",
        defaultService: storeSettings.defaultService || "Overnight",
      },
    });
  } catch (error) {
    console.error("Dashboard store settings fetch error:", error);
    return res.status(500).send({
      success: false,
      error: error?.message || "Failed to fetch store settings.",
    });
  }
});

app.put("/api/dashboard/store-settings", async (req, res) => {
  try {
    const shopDomain = normalizeShopDomain(
      typeof req.query?.shopDomain === "string" ? req.query.shopDomain.trim() : ""
    );

    if (!shopDomain) {
      return res.status(400).send({
        success: false,
        error: "shopDomain query parameter is required.",
      });
    }

    const { defaultCourier, defaultWeight, orderBooking, defaultService } = req.body || {};

    // Validate courier
    const validCouriers = ["M&P", "Leopards", "BarqRaftaar", "Trax"];
    if (defaultCourier && !validCouriers.includes(defaultCourier)) {
      return res.status(400).send({
        success: false,
        error: "Invalid courier selected.",
      });
    }

    // Validate service based on courier
    const validServicesByCourer = {
      "M&P": ["Overnight", "SecondDay"],
      "Leopards": ["Overnight", "Detain", "Overland"],
      "BarqRaftaar": ["Overnight", "Detain", "Overland"],
      "Trax": ["Overnight", "Detain", "Overland"],
    };

    if (defaultService) {
      const selectedCourier = defaultCourier || "M&P";
      const validServices = validServicesByCourer[selectedCourier] || ["Overnight"];
      if (!validServices.includes(defaultService)) {
        return res.status(400).send({
          success: false,
          error: `Invalid service for ${selectedCourier}. Valid options: ${validServices.join(", ")}`,
        });
      }
    }

    // Validate weight
    if (defaultWeight) {
      const weight = String(defaultWeight || "").trim();
      if (!/^\d+(\.\d{1,2})?$/.test(weight) || Number(weight) <= 0) {
        return res.status(400).send({
          success: false,
          error: "Invalid weight value. Must be a positive number up to 2 decimal places.",
        });
      }
    }

    // Validate booking mode
    const validBookingModes = ["Auto", "Manual"];
    if (orderBooking && !validBookingModes.includes(orderBooking)) {
      return res.status(400).send({
        success: false,
        error: "Invalid booking mode. Must be 'Auto' or 'Manual'.",
      });
    }

    const db = await connectToMongoDB();
    const updateData = {};

    // Update using ShopifyStoreSettings field name (matching the linking code)
    if (defaultCourier) updateData["ShopifyStoreSettings.defaultCourier"] = defaultCourier;
    if (defaultWeight) updateData["ShopifyStoreSettings.defaultWeight"] = String(defaultWeight);
    if (orderBooking) updateData["ShopifyStoreSettings.orderBooking"] = orderBooking;
    if (defaultService) updateData["ShopifyStoreSettings.defaultService"] = defaultService;

    // Also update settings field for backend compatibility
    if (defaultCourier) updateData["settings.defaultCourier"] = defaultCourier;
    if (defaultWeight) updateData["settings.defaultWeight"] = String(defaultWeight);
    if (orderBooking) updateData["settings.orderBooking"] = orderBooking;
    if (defaultService) updateData["settings.defaultService"] = defaultService;

    const result = await db.collection("stores").findOneAndUpdate(
      { shopDomain },
      { 
        $set: updateData,
      },
      { returnDocument: "after" }
    );

    // If findOneAndUpdate didn't return a value (rare race or driver behavior), try a direct lookup
    let storeDoc = result && result.value ? result.value : null;
    if (!storeDoc) {
      storeDoc = await db.collection("stores").findOne({ shopDomain });
    }

    if (!storeDoc) {
      return res.status(404).send({
        success: false,
        error: "Store not found.",
      });
    }

    // Return updated settings (check both field names)
    const updatedSettings = storeDoc.ShopifyStoreSettings || storeDoc.settings || {};

    return res.status(200).send({
      success: true,
      message: "Store settings updated successfully.",
      settings: {
        defaultCourier: updatedSettings.defaultCourier || "M&P",
        defaultWeight: updatedSettings.defaultWeight || "0.5",
        orderBooking: updatedSettings.orderBooking || "Auto",
        defaultService: updatedSettings.defaultService || "Overnight",
      },
    });
  } catch (error) {
    console.error("Dashboard store settings update error:", error);
    return res.status(500).send({
      success: false,
      error: error?.message || "Failed to update store settings.",
    });
  }
});

app.get("/api/orders/store", async (req, res) => {
  try {
    const storeName =
      typeof req.query?.storename === "string" ? req.query.storename.trim() : "";

    if (!storeName) {
      return res.status(400).send({
        success: false,
        error: "The storename query parameter is required.",
      });
    }

    const storeOrders = await getStoreOrdersFromMongoDB(storeName);

    if (!storeOrders) {
      return res.status(200).send({
        success: true,
        data: {
          storeName,
          orders: [],
        },
      });
    }

    return res.status(200).send({
      success: true,
      data: storeOrders,
    });
  } catch (error) {
    console.error("MongoDB get store orders error:", error);
    return res.status(200).send({
      success: true,
      data: {
        storeName: req.query?.storename || "",
        orders: [],
      },
      error: getMongoErrorMessage(error),
    });
  }
});

app.get("/api/mongo/status", async (_req, res) => {
  try {
    await connectToMongoDB();
    res.status(200).send({
      success: true,
      connected: true,
      database: DB_NAME,
      collection: ORDERS_COLLECTION,
      error: null,
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      connected: false,
      database: DB_NAME,
      collection: ORDERS_COLLECTION,
      error: getMongoErrorMessage(error),
    });
  }
});

app.get("/api/products/create", async (_req, res) => {
  let status = 200;
  let error = null;

  try {
    await productCreator(res.locals.shopify.session);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.log(`Failed to process products/create: ${errorMessage}`);
    status = 500;
    error = errorMessage;
  }
  res.status(status).send({ success: status === 200, error });
});

app.use(shopify.cspHeaders());
app.use(
  serveStatic(STATIC_PATH, {
    index: false,
    setHeaders(res, path) {
      if (path.endsWith(".jsx") || path.endsWith(".tsx")) {
        res.setHeader("Content-Type", "application/javascript");
      }
    },
  })
);

app.use(shopify.ensureInstalledOnShop(), async (_req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .sendFile(join(STATIC_PATH, "index.html"));
});

app.listen(PORT);
