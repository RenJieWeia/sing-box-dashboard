import { useSyncExternalStore } from "react";

import type { DaemonApi } from "../api/daemon";
import { loadStoredJson, saveStoredJson } from "../lib/storage";

export type TrafficRange = "5m" | "30m" | "1h" | "6h" | "24h";

export const TRAFFIC_RANGES: TrafficRange[] = ["5m", "30m", "1h", "6h", "24h"];

export const TRAFFIC_RANGE_MS: Record<TrafficRange, number> = {
  "5m": 5 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

export const TRAFFIC_SAMPLE_INTERVAL_MS = 10_000;
export const TRAFFIC_RETENTION_MS = 24 * 60 * 60 * 1000;
const RANGE_STORAGE_KEY = "traffic-range";
const SAVE_INTERVAL_MS = 60_000;
const MAX_SAMPLES = Math.ceil(TRAFFIC_RETENTION_MS / TRAFFIC_SAMPLE_INTERVAL_MS) + 8;

export interface TrafficSample {
  t: number;
  up: number;
  down: number;
  connectionsIn: number;
  connectionsOut: number;
  memory: number;
  goroutines: number;
}

type StoredSample = [number, number, number, number, number, number, number];

const stores = new Map<string, TrafficHistoryStore>();

class TrafficHistoryStore {
  private samples: TrafficSample[];
  private listeners = new Set<() => void>();
  private lastSavedAt = 0;
  private dirty = false;

  constructor(private readonly storageKey: string) {
    this.samples = this.load();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TrafficSample[] => this.samples;

  record(sample: TrafficSample): void {
    const last = this.samples[this.samples.length - 1];
    if (last !== undefined && sample.t - last.t < TRAFFIC_SAMPLE_INTERVAL_MS) {
      return;
    }
    const cutoff = sample.t - TRAFFIC_RETENTION_MS;
    const next = this.samples.filter((entry) => entry.t >= cutoff).concat(sample);
    this.samples = next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
    this.dirty = true;
    this.notify();
    this.save(false);
  }

  flush(): void {
    this.save(true);
  }

  clear(): void {
    this.samples = [];
    this.dirty = true;
    this.notify();
    this.save(true);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private save(force: boolean): void {
    if (!this.dirty) {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastSavedAt < SAVE_INTERVAL_MS) {
      return;
    }
    this.lastSavedAt = now;
    this.dirty = false;
    const stored: StoredSample[] = this.samples.map((sample) => [
      sample.t,
      Math.round(sample.up),
      Math.round(sample.down),
      sample.connectionsIn,
      sample.connectionsOut,
      Math.round(sample.memory),
      sample.goroutines,
    ]);
    try {
      saveStoredJson(this.storageKey, stored);
    } catch {
      // A full or read-only preference store must not break the live stream.
    }
  }

  private load(): TrafficSample[] {
    const raw = loadStoredJson(this.storageKey);
    if (!Array.isArray(raw)) {
      return [];
    }
    const cutoff = Date.now() - TRAFFIC_RETENTION_MS;
    const samples: TrafficSample[] = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 7) {
        continue;
      }
      const [t, up, down, connectionsIn, connectionsOut, memory, goroutines] = entry as StoredSample;
      if (
        typeof t !== "number" ||
        typeof up !== "number" ||
        typeof down !== "number" ||
        typeof connectionsIn !== "number" ||
        typeof connectionsOut !== "number" ||
        typeof memory !== "number" ||
        typeof goroutines !== "number" ||
        t < cutoff
      ) {
        continue;
      }
      samples.push({ t, up, down, connectionsIn, connectionsOut, memory, goroutines });
    }
    samples.sort((left, right) => left.t - right.t);
    return samples.length > MAX_SAMPLES ? samples.slice(samples.length - MAX_SAMPLES) : samples;
  }
}

export function getTrafficHistoryStore(serverId: string): TrafficHistoryStore {
  let store = stores.get(serverId);
  if (store === undefined) {
    store = new TrafficHistoryStore(`traffic-history:${serverId}`);
    stores.set(serverId, store);
  }
  return store;
}

export function loadTrafficRange(): TrafficRange {
  const value = loadStoredJson(RANGE_STORAGE_KEY);
  return TRAFFIC_RANGES.find((range) => range === value) ?? "1h";
}

export function saveTrafficRange(range: TrafficRange): void {
  saveStoredJson(RANGE_STORAGE_KEY, range);
}

export interface TrafficRangeSummary {
  sampleCount: number;
  durationMs: number;
  averageUp: number;
  averageDown: number;
  peakUp: number;
  peakDown: number;
  totalUp: number;
  totalDown: number;
  latest: TrafficSample | null;
}

export function summarizeTrafficSamples(
  samples: TrafficSample[],
  from: number,
  now: number,
): TrafficRangeSummary {
  let totalUp = 0;
  let totalDown = 0;
  let sampledMs = 0;
  let peakUp = 0;
  let peakDown = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const next = samples[index + 1];
    const delta = Math.max(0, Math.min((next?.t ?? now) - sample.t, 60_000));
    totalUp += sample.up * (delta / 1000);
    totalDown += sample.down * (delta / 1000);
    sampledMs += delta;
    peakUp = Math.max(peakUp, sample.up);
    peakDown = Math.max(peakDown, sample.down);
  }
  const start = samples.length > 0 ? Math.max(from, samples[0].t) : from;
  const durationMs = Math.max(now - start, 1);
  return {
    sampleCount: samples.length,
    durationMs,
    averageUp: sampledMs > 0 ? totalUp / (sampledMs / 1000) : 0,
    averageDown: sampledMs > 0 ? totalDown / (sampledMs / 1000) : 0,
    peakUp,
    peakDown,
    totalUp,
    totalDown,
    latest: samples[samples.length - 1] ?? null,
  };
}

export function useTrafficHistory(api: DaemonApi): TrafficSample[] {
  const store = getTrafficHistoryStore(api.config.id);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function startTrafficHistoryRecorder(api: DaemonApi): () => void {
  const store = getTrafficHistoryStore(api.config.id);
  let lastSampleAt = 0;

  const record = () => {
    const current = api.status.getSnapshot().data.current;
    if (!current || !current.trafficAvailable) {
      return;
    }
    const now = Date.now();
    if (now - lastSampleAt < TRAFFIC_SAMPLE_INTERVAL_MS) {
      return;
    }
    lastSampleAt = now;
    store.record({
      t: now,
      up: Number(current.uplink),
      down: Number(current.downlink),
      connectionsIn: current.connectionsIn,
      connectionsOut: current.connectionsOut,
      memory: Number(current.memory),
      goroutines: current.goroutines,
    });
  };

  const unsubscribe = api.status.subscribe(record);
  record();

  const flush = () => store.flush();
  const onVisibility = () => {
    if (document.hidden) {
      flush();
    }
  };
  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", flush);
    document.removeEventListener("visibilitychange", onVisibility);
    flush();
  };
}

export function clearTrafficHistory(api: DaemonApi): void {
  getTrafficHistoryStore(api.config.id).clear();
}
