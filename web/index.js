// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import crypto from "crypto";
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

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

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

startOrderSyncSchedulerWithRetry();

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
        updatedAt: linkedAt,
      },
      $setOnInsert: {
        settings: {
          defaultCourier: "M&P",
          defaultWeight: "0.5",
          orderBooking: "Manual",
        },
        orders: [],
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

async function attachShopifySession(req, res, next) {
  if (res.locals?.shopify?.session) {
    return next();
  }

  let requestShop = getRequestShop(req);

  if (!requestShop) {
    const bearerMatch = req.headers.authorization?.match(/Bearer (.+)/);

    if (bearerMatch?.[1]) {
      try {
        const payload = await shopify.api.session.decodeSessionToken(bearerMatch[1]);
        requestShop = payload.dest?.replace("https://", "") || "";
      } catch (error) {
        console.error("Failed to decode Shopify session token:", error);
      }
    }
  }

  try {
    const session = await getStoredSessionForShop(requestShop);

    if (session) {
      try {
        const usableSession = await ensureUsableSession(session);
        const activeSession = usableSession || session;

        res.locals.shopify = {
          ...(res.locals.shopify || {}),
          session: activeSession,
        };

        registerInstalledShop({ shopDomain: activeSession.shop }).catch((error) => {
          console.error("Failed to register installed shop from stored session:", error);
        });
      } catch (error) {
        console.error("Failed to prepare stored Shopify session:", error);
        res.locals.shopify = {
          ...(res.locals.shopify || {}),
          session,
        };
      }
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
              email
              phone
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
        await registerInstalledShop({ shopDomain: session.shop });
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


// reading orders
app.get("/api/orders/all", async (_req, res) => {
  try {
    if (!res.locals?.shopify?.session) {
      console.error("Orders all: No session found");
      return res.status(200).send({ success: true, data: [] });
    }

    let data = [];

    try {
      data = await fetchOrders(res.locals.shopify.session);
    } catch (shopifyError) {
      console.error("Failed to fetch orders from Shopify:", shopifyError);
    }

    return res.status(200).send({ success: true, data });
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

    await registerInstalledShop({ shopDomain, storeName });

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

    let orders = [];
    let saveResult = { savedCount: 0 };
    let orderSyncError = null;

    try {
      orders = await fetchOrders(res.locals.shopify.session);
      saveResult = await saveOrdersToMongoDB(orders, { storeName, shopDomain });
    } catch (syncError) {
      orderSyncError = syncError?.message || "Failed to sync Shopify orders.";
      console.error("Dashboard link order sync error:", syncError);
    }

    return res.status(200).send({
      success: true,
      message: orderSyncError
        ? "Dashboard user linked to this Shopify store. Order sync failed."
        : "Dashboard user linked to this Shopify store.",
      linkedUser: linkResponse.data.data,
      shop: {
        storeName,
        shopDomain,
      },
      orders: {
        fetchedCount: orders.length,
        savedCount: saveResult.savedCount || 0,
        error: orderSyncError,
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
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use(shopify.ensureInstalledOnShop(), async (_req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT);
