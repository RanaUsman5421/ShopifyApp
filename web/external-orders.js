// @ts-nocheck
import { timingSafeEqual } from "crypto";
import express from "express";

import { getMongoErrorMessage } from "./database/connection.js";
import { getStoreOrdersFromMongoDB } from "./database/orders.js";

const router = express.Router();

function getExternalApiToken() {
  const token = process.env.EXTERNAL_API_TOKEN;

  return typeof token === "string" ? token.trim() : "";
}

/**
 * @param {string} expected
 * @param {string} actual
 */
function tokensMatch(expected, actual) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * @param {import("express").Request} req
 */
function readProvidedToken(req) {
  const authorizationHeader = req.get("authorization");

  if (authorizationHeader?.startsWith("Bearer ")) {
    return authorizationHeader.slice("Bearer ".length).trim();
  }

  const apiKeyHeader = req.get("x-api-key");

  return typeof apiKeyHeader === "string" ? apiKeyHeader.trim() : "";
}

router.use((req, res, next) => {
  const expectedToken = getExternalApiToken();

  if (!expectedToken) {
    return res.status(500).send({
      success: false,
      error: "External orders API is not configured.",
    });
  }

  const providedToken = readProvidedToken(req);

  if (!providedToken || !tokensMatch(expectedToken, providedToken)) {
    return res.status(401).send({
      success: false,
      error: "Unauthorized.",
    });
  }

  next();
});

router.get("/orders", async (req, res) => {
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
      return res.status(404).send({
        success: false,
        error: "No saved orders were found for this store.",
      });
    }

    return res.status(200).send({
      success: true,
      data: {
        storeName: storeOrders.storeName,
        orders: Array.isArray(storeOrders.orders) ? storeOrders.orders : [],
      },
    });
  } catch (error) {
    console.error("External orders API error:", error);
    return res.status(500).send({
      success: false,
      error: getMongoErrorMessage(error),
    });
  }
});

export default router;
