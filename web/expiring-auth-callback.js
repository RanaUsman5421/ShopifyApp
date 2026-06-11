import {
  BotActivityDetected,
  CookieNotFound,
  InvalidOAuthError,
  privacyTopics,
} from "@shopify/shopify-api";

import shopify from "./shopify.js";

async function registerWebhooks(session) {
  const { api, config } = shopify;
  config.logger.debug("Registering webhooks", { shop: session.shop });

  const responsesByTopic = await api.webhooks.register({ session });

  for (const topic of Object.keys(responsesByTopic)) {
    for (const response of responsesByTopic[topic]) {
      if (!response.success && !privacyTopics.includes(topic)) {
        const result = response.result;
        const message =
          result?.errors?.[0]?.message || JSON.stringify(result?.data || result);

        config.logger.error(`Failed to register ${topic} webhook: ${message}`, {
          shop: session.shop,
        });
      }
    }
  }
}

async function handleCallbackError(req, res, error) {
  if (error instanceof InvalidOAuthError) {
    res.status(400).send(error.message);
    return;
  }

  if (error instanceof CookieNotFound) {
    await shopify.auth.begin()(req, res);
    return;
  }

  if (error instanceof BotActivityDetected) {
    res.status(410).send(error.message);
    return;
  }

  res.status(500).send(error.message);
}

export async function handleExpiringAuthCallback(req, res, next) {
  const { api, config } = shopify;

  try {
    config.logger.info("Handling request to complete OAuth process");

    const callbackResponse = await api.auth.callback({
      rawRequest: req,
      rawResponse: res,
      expiring: true,
    });

    await config.sessionStorage.storeSession(callbackResponse.session);

    if (!callbackResponse.session.isOnline) {
      await registerWebhooks(callbackResponse.session);
    }

    res.locals.shopify = {
      ...res.locals.shopify,
      session: callbackResponse.session,
    };

    return next();
  } catch (error) {
    config.logger.error(`Failed to complete OAuth with error: ${error}`);
    await handleCallbackError(req, res, error);
  }
}
