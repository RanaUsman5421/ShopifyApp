import { useCallback } from "react";

/**
 * A hook that returns an auth-aware fetch function.
 * @desc The returned fetch function matches the browser's fetch API.
 * It will provide the following functionality:
 *
 * 1. Add a Shopify session token to the request.
 * 2. Check response for `X-Shopify-API-Request-Failure-Reauthorize` header.
 * 3. Redirect the user to the reauthorization URL if the header is present.
 *
 * @returns {Function} fetch function
 */
export function useAuthenticatedFetch() {
  return useCallback(async (uri, options = {}) => {
    const headers = new Headers(options.headers || {});

    if (window.shopify?.idToken) {
      const token = await window.shopify.idToken();
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(uri, {
      ...options,
      headers,
    });

    checkHeadersForReauthorization(response.headers);
    return response;
  }, []);
}

function checkHeadersForReauthorization(headers) {
  if (headers.get("X-Shopify-API-Request-Failure-Reauthorize") === "1") {
    const authUrlHeader =
      headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url") ||
      `/api/auth`;

    window.open(
      authUrlHeader.startsWith("/")
        ? `https://${window.location.host}${authUrlHeader}`
        : authUrlHeader,
      "_top"
    );
  }
}