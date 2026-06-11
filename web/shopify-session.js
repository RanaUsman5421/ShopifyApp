import { HttpResponseError, InvalidJwtError } from "@shopify/shopify-api";

import shopify, { sessionStorage } from "./shopify.js";

const TEST_GRAPHQL_QUERY = `query shopifyAppShopName {
  shop {
    name
  }
}`;

function getErrorMessage(error) {
  if (!error) {
    return "";
  }

  const bodyErrors = error?.response?.body?.errors;
  if (typeof bodyErrors === "string") {
    return bodyErrors;
  }

  return String(error.message || "");
}

export function isNonExpiringTokenError(error) {
  if (!(error instanceof HttpResponseError)) {
    return false;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    error.response?.code === 403 &&
    message.includes("non-expiring access tokens are no longer accepted")
  );
}

export function isInvalidAccessTokenError(error) {
  if (!(error instanceof HttpResponseError)) {
    return false;
  }

  return error.response?.code === 401 || isNonExpiringTokenError(error);
}

export async function migrateSessionToExpiringToken(session) {
  if (!session?.shop || !session?.accessToken) {
    throw new Error("A stored Shopify session is required to migrate access tokens.");
  }

  const { session: migratedSession } = await shopify.api.auth.migrateToExpiringToken({
    shop: session.shop,
    nonExpiringOfflineAccessToken: session.accessToken,
  });

  await sessionStorage.storeSession(migratedSession);
  return migratedSession;
}

async function refreshSessionIfNeeded(session) {
  if (!session?.refreshToken || !session?.expires) {
    return session;
  }

  const expiresAt = new Date(session.expires).getTime();
  const shouldRefresh = Number.isFinite(expiresAt) && expiresAt <= Date.now() + 60 * 1000;

  if (!shouldRefresh) {
    return session;
  }

  const { session: refreshedSession } = await shopify.api.auth.refreshToken({
    shop: session.shop,
    refreshToken: session.refreshToken,
  });

  await sessionStorage.storeSession(refreshedSession);
  return refreshedSession;
}

async function hasValidAccessToken(session) {
  try {
    const client = new shopify.api.clients.Graphql({ session });
    await client.request(TEST_GRAPHQL_QUERY);
    return true;
  } catch (error) {
    if (error instanceof HttpResponseError && error.response.code === 401) {
      return false;
    }

    if (isNonExpiringTokenError(error)) {
      return false;
    }

    throw error;
  }
}

export async function ensureUsableSession(session) {
  if (!session?.accessToken) {
    return session;
  }

  let activeSession = await refreshSessionIfNeeded(session);

  if (!activeSession.isOnline && !activeSession.expires) {
    try {
      activeSession = await migrateSessionToExpiringToken(activeSession);
    } catch (error) {
      console.warn("Failed to proactively migrate Shopify session:", error?.message || error);
    }
  }

  if (await hasValidAccessToken(activeSession)) {
    return activeSession;
  }

  if (!activeSession.isOnline && !activeSession.expires) {
    activeSession = await migrateSessionToExpiringToken(activeSession);

    if (await hasValidAccessToken(activeSession)) {
      return activeSession;
    }
  }

  return null;
}

export function safeValidateAuthenticatedSession() {
  const { api, config } = shopify;

  return async function validateAuthenticatedSession(req, res, next) {
    config.logger.info("Running validateAuthenticatedSession");

    let sessionId;

    try {
      sessionId = await api.session.getCurrentId({
        isOnline: config.useOnlineTokens,
        rawRequest: req,
        rawResponse: res,
      });
    } catch (error) {
      config.logger.error(`Error when loading session from storage: ${error}`);

      if (error instanceof InvalidJwtError) {
        res.status(401).send(error.message);
        return;
      }

      res.status(500).send(error.message);
      return;
    }

    let session;

    if (sessionId) {
      try {
        session = await config.sessionStorage.loadSession(sessionId);
      } catch (error) {
        config.logger.error(`Error when loading session from storage: ${error}`);
        res.status(500).send(error.message);
        return;
      }
    }

    let shop = api.utils.sanitizeShop(req.query.shop) || session?.shop;

    if (session && shop && session.shop !== shop) {
      return shopify.auth.begin()(req, res);
    }

    if (session?.isActive?.(api.config.scopes)) {
      try {
        const usableSession = await ensureUsableSession(session);

        if (usableSession) {
          res.locals.shopify = {
            ...res.locals.shopify,
            session: usableSession,
          };
          return next();
        }
      } catch (error) {
        console.error("Failed to validate Shopify session:", error?.message || error);
      }
    }

    const bearerPresent = req.headers.authorization?.match(/Bearer (.*)/);
    if (bearerPresent && !shop) {
      if (session?.shop) {
        shop = session.shop;
      } else if (api.config.isEmbeddedApp) {
        const payload = await api.session.decodeSessionToken(bearerPresent[1]);
        shop = payload.dest.replace("https://", "");
      }
    }

    const redirectUri = `${config.auth.path}?shop=${shop}`;
    config.logger.info(`Session was not valid. Redirecting to ${redirectUri}`, { shop });

    return shopify.redirectOutOfApp({
      req,
      res,
      redirectUri,
      shop,
    });
  };
}
