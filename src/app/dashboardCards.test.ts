import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dashboardCardIds,
  loadDashboardCardsConfig,
  orderedEnabledCards,
  resetDashboardCardsConfig,
  saveDashboardCardsConfig,
  toggleCard,
} from "./dashboardCards";

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

describe("dashboard cards", () => {
  it("enables every card by default", () => {
    const config = loadDashboardCardsConfig(false);
    expect(config.enabled).toEqual(dashboardCardIds(false));
    expect(config.order).toEqual(dashboardCardIds(false));
    expect(config.enabled).not.toContain("systemProxy");
    expect(config.enabled).not.toContain("profile");
  });

  it("inserts newly added cards at their default position for existing configs", () => {
    saveDashboardCardsConfig({
      enabled: ["uploadTraffic", "profile"],
      order: ["uploadTraffic", "status", "connections", "profile"],
    });
    const config = loadDashboardCardsConfig(true);
    expect(config.order).toEqual([
      "uploadTraffic",
      "downloadTraffic",
      "traffic",
      "status",
      "connections",
      "topOutbound",
      "systemProxy",
      "clashMode",
      "profile",
    ]);
    expect(config.enabled).toEqual(["uploadTraffic", "profile"]);
  });

  it("drops unknown cards and keeps the permanent card enabled", () => {
    saveDashboardCardsConfig({
      enabled: ["uploadTraffic", "nope"],
      order: ["uploadTraffic", "nope", "profile"],
    });
    const config = loadDashboardCardsConfig(true);
    expect(config.enabled).toEqual(["uploadTraffic", "profile"]);
    expect(config.order).not.toContain("nope");
  });

  it("toggles optional cards but not permanent ones", () => {
    const config = loadDashboardCardsConfig(false);
    expect(toggleCard(config, "status").enabled).not.toContain("status");
    const withStatus = toggleCard(toggleCard(config, "status"), "status");
    expect(withStatus.enabled).toContain("status");
    expect(toggleCard(config, "profile")).toEqual(config);
  });

  it("resets to the defaults", () => {
    saveDashboardCardsConfig({ enabled: ["uploadTraffic"], order: ["uploadTraffic"] });
    const config = resetDashboardCardsConfig(false);
    expect(config).toEqual({
      enabled: dashboardCardIds(false),
      order: dashboardCardIds(false),
    });
    expect(orderedEnabledCards(config)).toEqual(dashboardCardIds(false));
  });
});
