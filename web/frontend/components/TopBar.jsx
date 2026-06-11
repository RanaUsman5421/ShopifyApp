import React, { useEffect, useState } from 'react'
import { useAuthenticatedFetch } from '../hooks/useAuthenticatedFetch.js'

function getStoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop");

  if (shop) {
    return shop;
  }

  const host = params.get("host") || window.__SHOPIFY_DEV_HOST;

  if (!host) {
    return "";
  }

  try {
    const paddedHost = host.padEnd(Math.ceil(host.length / 4) * 4, "=");
    const decodedHost = atob(paddedHost.replace(/-/g, "+").replace(/_/g, "/"));
    const storeHandle = decodedHost.match(/\/store\/([^/?]+)/)?.[1];

    return storeHandle ? `${storeHandle}.myshopify.com` : "";
  } catch (error) {
    return "";
  }
}

function normalizeStoreInfoStoreName(name, domain) {
  const rawName = typeof name === "string" ? name.trim() : "";
  const rawDomain = typeof domain === "string" ? domain.trim() : "";

  if (rawName && !rawName.toLowerCase().endsWith(".myshopify.com")) {
    return rawName;
  }

  if (rawDomain) {
    return rawDomain.replace(/\.myshopify\.com$/i, "");
  }

  return rawName || rawDomain || "";
}

export function TopBar() {
  const [storeName, setStoreName] = useState(() => getStoreFromUrl());
  const authenticatedFetch = useAuthenticatedFetch();

  useEffect(() => {
    let isMounted = true;

    async function fetchStoreInfo() {
      try {
        const request = await authenticatedFetch("/api/store/info", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        // Read the raw text first to avoid JSON parse errors on empty responses
        const raw = await request.text();
        let response = null;
        if (raw) {
          try {
            response = JSON.parse(raw);
          } catch (err) {
            console.warn("Failed to parse JSON from /api/store/info", err);
            response = null;
          }
        }

        console.log("Store info response:", response);

        if (!request.ok) {
          const msg = (response && (response.error || response.message)) || `HTTP ${request.status}`;
          console.error("Store info request failed:", msg);
          throw new Error(msg);
        }

        // Extract store name - prefer the actual display name from Shopify
        const storeNameFromAPI = response?.data?.displayName ?? response?.data?.name;
        const storeDomain = response?.data?.myshopifyDomain;
        
        // Normalize the display value so .myshopify.com is not shown as the store name
        const nextStoreName =
          storeNameFromAPI ||
          normalizeStoreInfoStoreName(response?.data?.name, storeDomain) ||
          storeDomain ||
          getStoreFromUrl();

        console.log("Setting store name to:", nextStoreName, "from API name:", storeNameFromAPI);

        if (isMounted) {
          setStoreName(nextStoreName);
        }
      } catch (error) {
        console.error("Error fetching store info:", error);
        // Fall back to extracting from URL only if state hasn't been set properly
        if (isMounted) {
          setStoreName((current) => {
            const fallback = getStoreFromUrl();
            console.log("Using fallback store name:", fallback, "current:", current);
            return current || fallback;
          });
        }
      }
    }

    fetchStoreInfo();

    return () => {
      isMounted = false;
    };
  }, [authenticatedFetch]);

  return (
    <div className='topbar-section'>
      <div className="logo-block">
        <img className='logo' src="../assets/logo.png" alt="logo image" />
        <div>
          <h1 className='text-bold h4'>{storeName}</h1>
          <p className="text-small">Merchant dashboard</p>
        </div>
      </div>
    </div>
  )
}
