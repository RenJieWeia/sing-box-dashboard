import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadTrafficRange,
  saveTrafficRange,
  summarizeTrafficSamples,
  type TrafficSample,
} from "./trafficHistory";

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

function sample(t: number, up: number, down: number): TrafficSample {
  return {
    t,
    up,
    down,
    connectionsIn: 1,
    connectionsOut: 2,
    memory: 100,
    goroutines: 10,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

describe("summarizeTrafficSamples", () => {
  it("computes totals from rate * elapsed time and finds peaks", () => {
    const samples = [sample(0, 100, 200), sample(1000, 300, 400), sample(2000, 50, 100)];
    const summary = summarizeTrafficSamples(samples, 0, 3000);
    expect(summary.peakUp).toBe(300);
    expect(summary.peakDown).toBe(400);
    expect(summary.totalUp).toBeCloseTo(100 + 300 + 50);
    expect(summary.totalDown).toBeCloseTo(200 + 400 + 100);
    expect(summary.averageUp).toBeCloseTo(150);
    expect(summary.averageDown).toBeCloseTo(700 / 3);
    expect(summary.sampleCount).toBe(3);
    expect(summary.latest?.t).toBe(2000);
  });

  it("caps the last sample delta at one minute", () => {
    const summary = summarizeTrafficSamples([sample(0, 60, 0)], 0, 600_000);
    expect(summary.totalUp).toBeCloseTo(3600);
  });
});

describe("traffic range", () => {
  it("defaults to one hour and round-trips a stored range", () => {
    expect(loadTrafficRange()).toBe("1h");
    saveTrafficRange("24h");
    expect(loadTrafficRange()).toBe("24h");
  });

  it("ignores invalid values", () => {
    localStorage.setItem("sing-box-dashboard.traffic-range", JSON.stringify("nope"));
    expect(loadTrafficRange()).toBe("1h");
  });
});
