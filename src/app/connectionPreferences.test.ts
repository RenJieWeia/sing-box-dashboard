import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONNECTION_FILTERS } from "../lib/traffic";
import {
  loadConnectionFilters,
  loadConnectionGroupDimension,
  loadConnectionGroupSort,
  loadConnectionSortDirection,
  loadConnectionSortMode,
  loadConnectionViewMode,
  saveConnectionFilters,
  saveConnectionViewMode,
  setPendingConnectionView,
  takePendingConnectionView,
} from "./connectionPreferences";

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }

  removeItem(key: string) {
    this.map.delete(key);
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

describe("connection preferences", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadConnectionFilters()).toEqual(DEFAULT_CONNECTION_FILTERS);
    expect(loadConnectionViewMode()).toBe("list");
    expect(loadConnectionSortMode()).toBe("date");
    expect(loadConnectionSortDirection()).toBe("desc");
    expect(loadConnectionGroupDimension()).toBe("outbound");
    expect(loadConnectionGroupSort()).toBe("traffic");
  });

  it("round-trips filters", () => {
    saveConnectionFilters({
      state: "all",
      network: "udp",
      sourceIp: "10.0.0.1",
      inbound: "mixed-in",
      outbound: "proxy",
      rule: "rule-a",
      process: "curl",
      protocol: "tls",
      window: "5m",
    });
    expect(loadConnectionFilters()).toEqual({
      state: "all",
      network: "udp",
      sourceIp: "10.0.0.1",
      inbound: "mixed-in",
      outbound: "proxy",
      rule: "rule-a",
      process: "curl",
      protocol: "tls",
      window: "5m",
    });
  });

  it("migrates the legacy state filter", () => {
    localStorage.setItem("sing-box-dashboard.connection-state-filter", JSON.stringify("closed"));
    expect(loadConnectionFilters()).toEqual({ ...DEFAULT_CONNECTION_FILTERS, state: "closed" });
  });

  it("drops invalid stored values", () => {
    localStorage.setItem(
      "sing-box-dashboard.connection-filters",
      JSON.stringify({ state: "bogus", network: 5, window: "nope" }),
    );
    expect(loadConnectionFilters()).toEqual(DEFAULT_CONNECTION_FILTERS);
  });

  it("remembers the view mode", () => {
    saveConnectionViewMode("analysis");
    expect(loadConnectionViewMode()).toBe("analysis");
  });

  it("passes a pending view to the next connections view", () => {
    setPendingConnectionView({ view: "analysis", filters: { outbound: "proxy" } });
    expect(takePendingConnectionView()).toEqual({
      view: "analysis",
      filters: { outbound: "proxy" },
    });
    expect(takePendingConnectionView()).toBeNull();
  });
});
