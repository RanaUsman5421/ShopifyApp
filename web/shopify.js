import { ApiVersion } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";

const DB_PATH = `${process.cwd()}/database.sqlite`;
export const sessionStorage = new SQLiteSessionStorage(DB_PATH);

const shopify = shopifyApp({
  api: {
    apiVersion: ApiVersion.April26,
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  sessionStorage,
});

export default shopify;
