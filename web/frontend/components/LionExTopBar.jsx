import { useState } from "react";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";
import { triggerOrderSync } from "../utils/orderSync";

export function MaterialIcon({ children, className = "", filled = false }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {children}
    </span>
  );
}

export function SyncButton({ variant = "primary", children }) {
  const authenticatedFetch = useAuthenticatedFetch();
  const [syncState, setSyncState] = useState("idle");

  async function handleClick() {
    if (syncState !== "idle") return;

    setSyncState("syncing");

    try {
      await triggerOrderSync(authenticatedFetch);
      setSyncState("finished");
      window.setTimeout(() => setSyncState("idle"), 2000);
    } catch (error) {
      console.error("Order sync failed:", error);
      setSyncState("idle");
    }
  }

  const label =
    syncState === "syncing" ? "Syncing..." : syncState === "finished" ? "Finished" : children;
  const icon = syncState === "syncing" ? "sync" : syncState === "finished" ? "check" : "refresh";

  return (
    <button
      className={`lionex-button lionex-button--${variant}`}
      type="button"
      onClick={handleClick}
      disabled={syncState !== "idle"}
    >
      <MaterialIcon className={syncState === "syncing" ? "lionex-spin" : ""}>{icon}</MaterialIcon>
      {label}
    </button>
  );
}

export default function LionExTopBar({
  className = "",
  placeholder = "Search shipping, orders, products...",
  searchValue,
  onSearchChange,
}) {
  const [searchFocused, setSearchFocused] = useState(false);
  const isControlledSearch = typeof onSearchChange === "function";

  return (
    <header className={`lionex-topbar${className ? ` ${className}` : ""}`}>
      <div className={`lionex-search${searchFocused ? " lionex-search--focused" : ""}`}>
        <MaterialIcon>search</MaterialIcon>
        <input
          type="text"
          placeholder={placeholder}
          value={isControlledSearch ? searchValue : undefined}
          onChange={
            isControlledSearch ? (event) => onSearchChange(event.target.value) : undefined
          }
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
      </div>

      <div className="lionex-topbar__actions">
        <div className="lionex-icon-actions">
          <button className="lionex-icon-button lionex-icon-button--notify" type="button">
            <MaterialIcon>notifications</MaterialIcon>
            <span aria-hidden="true" />
          </button>
          <button className="lionex-icon-button" type="button">
            <MaterialIcon>help</MaterialIcon>
          </button>
        </div>
        <div className="lionex-divider" />
        <button className="lionex-button lionex-button--secondary" type="button">
          Settings
        </button>
        <SyncButton>Sync Now</SyncButton>
      </div>
    </header>
  );
}
