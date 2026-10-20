import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { ConnectionRow } from "../api/daemon";
import { ConnectionSchema, ProcessInfoSchema } from "../gen/daemon/started_service_pb";
import {
  collectFacetValues,
  connectionSourceIp,
  DEFAULT_CONNECTION_FILTERS,
  filterConnections,
  groupTraffic,
  matchesConnectionSearch,
  sortConnectionRows,
  sortTrafficGroups,
  summarizeTraffic,
  trafficShare,
  type ConnectionFilters,
} from "./traffic";

interface RowOptions {
  id: string;
  outbound?: string;
  inbound?: string;
  network?: string;
  rule?: string;
  domain?: string;
  destination?: string;
  protocol?: string;
  process?: string;
  source?: string;
  createdAt?: number;
  closedAt?: number | null;
  uplinkTotal?: bigint;
  downlinkTotal?: bigint;
  uplinkRate?: number;
  downlinkRate?: number;
}

function makeRow(options: RowOptions): ConnectionRow {
  const connection = create(ConnectionSchema, {
    id: options.id,
    inbound: options.inbound ?? "mixed-in",
    inboundType: "mixed",
    network: options.network ?? "tcp",
    source: options.source ?? "127.0.0.1:50000",
    destination: options.destination ?? "example.com:443",
    domain: options.domain ?? "",
    protocol: options.protocol ?? "",
    rule: options.rule ?? "",
    outbound: options.outbound ?? "direct",
    outboundType: "direct",
    createdAt: BigInt(options.createdAt ?? 1_000),
    processInfo: options.process
      ? create(ProcessInfoSchema, { processPath: `/usr/bin/${options.process}`, processId: 42 })
      : undefined,
  });
  return {
    connection,
    uplinkRate: options.uplinkRate ?? 0,
    downlinkRate: options.downlinkRate ?? 0,
    uplinkTotal: options.uplinkTotal ?? 0n,
    downlinkTotal: options.downlinkTotal ?? 0n,
    closedAt: options.closedAt ?? null,
  };
}

const NOW = 10_000_000;

describe("connectionSourceIp", () => {
  it("extracts the IP from IPv4 and bracketed IPv6 sources", () => {
    expect(connectionSourceIp(makeRow({ id: "a", source: "192.168.1.42:51234" }).connection)).toBe(
      "192.168.1.42",
    );
    expect(connectionSourceIp(makeRow({ id: "b", source: "[2001:db8::1]:443" }).connection)).toBe(
      "2001:db8::1",
    );
    expect(connectionSourceIp(makeRow({ id: "c", source: "2001:db8::1" }).connection)).toBe(
      "2001:db8::1",
    );
    expect(connectionSourceIp(makeRow({ id: "d", source: "[fe80::1%eth0]:8080" }).connection)).toBe(
      "fe80::1%eth0",
    );
  });
});

describe("matchesConnectionSearch", () => {
  const row = makeRow({
    id: "a",
    domain: "api.example.com",
    outbound: "proxy",
    rule: "geosite-example",
    process: "curl",
  });

  it("matches plain tokens across destination, domain, outbound, rule and process", () => {
    expect(matchesConnectionSearch(row, "example")).toBe(true);
    expect(matchesConnectionSearch(row, "proxy")).toBe(true);
    expect(matchesConnectionSearch(row, "geosite")).toBe(true);
    expect(matchesConnectionSearch(row, "curl")).toBe(true);
    expect(matchesConnectionSearch(row, "missing")).toBe(false);
  });

  it("supports key:value filters", () => {
    expect(matchesConnectionSearch(row, "outbound:proxy")).toBe(true);
    expect(matchesConnectionSearch(row, "network:tcp")).toBe(true);
    expect(matchesConnectionSearch(row, "network:udp")).toBe(false);
    expect(matchesConnectionSearch(row, "rule:geosite")).toBe(true);
    expect(matchesConnectionSearch(row, "process:curl")).toBe(true);
    expect(matchesConnectionSearch(row, "domain:example.com")).toBe(true);
    expect(matchesConnectionSearch(row, "source_ip:127.0.0.1")).toBe(true);
    expect(matchesConnectionSearch(row, "source_ip:10.0.0.1")).toBe(false);
  });

  it("supports negated tokens", () => {
    expect(matchesConnectionSearch(row, "-udp")).toBe(true);
    expect(matchesConnectionSearch(row, "example -curl")).toBe(false);
    expect(matchesConnectionSearch(row, "example -nope")).toBe(true);
  });

  it("requires every token to match", () => {
    expect(matchesConnectionSearch(row, "example proxy")).toBe(true);
    expect(matchesConnectionSearch(row, "example udp")).toBe(false);
  });
});

describe("filterConnections", () => {
  const now = NOW;
  const rows = [
    makeRow({
      id: "1",
      outbound: "proxy",
      rule: "rule-a",
      process: "curl",
      protocol: "tls",
      uplinkTotal: 10n,
    }),
    makeRow({ id: "2", outbound: "direct", rule: "rule-b", network: "udp", protocol: "quic" }),
    makeRow({
      id: "3",
      outbound: "proxy",
      rule: "rule-a",
      closedAt: now - 30_000,
      createdAt: now - 60_000,
    }),
    makeRow({
      id: "4",
      outbound: "block",
      closedAt: now - 600_000,
      createdAt: now - 700_000,
    }),
  ];

  const filters = (patch: Partial<ConnectionFilters>): ConnectionFilters => ({
    ...DEFAULT_CONNECTION_FILTERS,
    ...patch,
  });

  it("filters by state", () => {
    expect(filterConnections(rows, filters({ state: "active" }), "", now).map((row) => row.connection.id)).toEqual([
      "1",
      "2",
    ]);
    expect(filterConnections(rows, filters({ state: "closed" }), "", now).map((row) => row.connection.id)).toEqual([
      "3",
      "4",
    ]);
    expect(filterConnections(rows, filters({ state: "all" }), "", now)).toHaveLength(4);
  });

  it("filters by facet values", () => {
    expect(
      filterConnections(rows, filters({ state: "all", outbound: "proxy" }), "", now).map(
        (row) => row.connection.id,
      ),
    ).toEqual(["1", "3"]);
    expect(
      filterConnections(rows, filters({ state: "all", network: "udp" }), "", now).map(
        (row) => row.connection.id,
      ),
    ).toEqual(["2"]);
    expect(
      filterConnections(rows, filters({ state: "all", rule: "rule-a" }), "", now).map(
        (row) => row.connection.id,
      ),
    ).toEqual(["1", "3"]);
    expect(
      filterConnections(rows, filters({ state: "all", protocol: "quic" }), "", now).map(
        (row) => row.connection.id,
      ),
    ).toEqual(["2"]);
    expect(
      filterConnections(rows, filters({ state: "all", sourceIp: "127.0.0.1" }), "", now).map(
        (row) => row.connection.id,
      ),
    ).toEqual(["1", "2", "3", "4"]);
    expect(
      filterConnections(rows, filters({ state: "all", sourceIp: "10.0.0.9" }), "", now),
    ).toHaveLength(0);
  });

  it("applies the time window to closed connections only", () => {
    expect(
      filterConnections(rows, filters({ state: "all", window: "1m" }), "", now).map(
        (row) => row.connection.id,
      ),
    ).toEqual(["1", "2", "3"]);
    expect(
      filterConnections(rows, filters({ state: "all", window: "1h" }), "", now).map(
        (row) => row.connection.id,
      ),
    ).toEqual(["1", "2", "3", "4"]);
  });
});

describe("groupTraffic", () => {
  const rows = [
    makeRow({ id: "1", outbound: "proxy", uplinkTotal: 100n, downlinkTotal: 200n, uplinkRate: 10, downlinkRate: 20 }),
    makeRow({ id: "2", outbound: "proxy", uplinkTotal: 50n, downlinkTotal: 50n, closedAt: 1 }),
    makeRow({ id: "3", outbound: "direct", uplinkTotal: 1000n, downlinkTotal: 0n }),
  ];

  it("aggregates totals, rates, counts and active count per group", () => {
    const groups = groupTraffic(rows, "outbound");
    const proxy = groups.find((group) => group.key === "proxy");
    expect(proxy).toEqual({
      key: "proxy",
      count: 2,
      activeCount: 1,
      uplinkTotal: 150n,
      downlinkTotal: 250n,
      uplinkRate: 10,
      downlinkRate: 20,
    });
    const direct = groups.find((group) => group.key === "direct");
    expect(direct?.count).toBe(1);
    expect(direct?.activeCount).toBe(1);
    expect(direct?.uplinkTotal).toBe(1000n);
  });

  it("groups source by IP rather than IP:port", () => {
    const groups = groupTraffic(
      [
        makeRow({ id: "1", source: "10.0.0.1:1000" }),
        makeRow({ id: "2", source: "10.0.0.1:2000" }),
        makeRow({ id: "3", source: "10.0.0.2:1000" }),
      ],
      "source",
    );
    expect(groups.map((group) => group.key).sort()).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(groups.find((group) => group.key === "10.0.0.1")?.count).toBe(2);
  });

  it("can group by domain falling back to destination", () => {
    const groups = groupTraffic(
      [makeRow({ id: "1", domain: "a.example" }), makeRow({ id: "2", destination: "1.1.1.1:53" })],
      "domain",
    );
    expect(groups.map((group) => group.key).sort()).toEqual(["1.1.1.1:53", "a.example"]);
  });
});

describe("sortTrafficGroups", () => {
  const rows = [
    makeRow({ id: "1", outbound: "small", uplinkTotal: 10n }),
    makeRow({ id: "2", outbound: "large", uplinkTotal: 1000n }),
    makeRow({ id: "3", outbound: "medium", uplinkTotal: 100n }),
  ];

  it("sorts by traffic descending by default", () => {
    const groups = sortTrafficGroups(groupTraffic(rows, "outbound"), "traffic", "desc");
    expect(groups.map((group) => group.key)).toEqual(["large", "medium", "small"]);
  });

  it("sorts by traffic ascending", () => {
    const groups = sortTrafficGroups(groupTraffic(rows, "outbound"), "traffic", "asc");
    expect(groups.map((group) => group.key)).toEqual(["small", "medium", "large"]);
  });

  it("sorts by name", () => {
    const groups = sortTrafficGroups(groupTraffic(rows, "outbound"), "name", "asc");
    expect(groups.map((group) => group.key)).toEqual(["large", "medium", "small"]);
  });
});

describe("sortConnectionRows", () => {
  const rows = [
    makeRow({ id: "old", createdAt: 1_000, closedAt: NOW - 1, uplinkTotal: 5n }),
    makeRow({ id: "new", createdAt: 3_000, uplinkTotal: 20n }),
    makeRow({ id: "middle", createdAt: 2_000, uplinkTotal: 10n }),
  ];

  it("sorts by total traffic", () => {
    expect(
      sortConnectionRows(rows, "trafficTotal", "desc", NOW).map((row) => row.connection.id),
    ).toEqual(["new", "middle", "old"]);
  });

  it("sorts by duration", () => {
    expect(
      sortConnectionRows(rows, "duration", "desc", NOW).map((row) => row.connection.id),
    ).toEqual(["old", "middle", "new"]);
  });
});

describe("summarizeTraffic", () => {
  it("counts active and closed connections and sums traffic", () => {
    const summary = summarizeTraffic([
      makeRow({ id: "1", uplinkTotal: 10n, downlinkTotal: 20n, uplinkRate: 1, downlinkRate: 2 }),
      makeRow({ id: "2", uplinkTotal: 5n, downlinkTotal: 5n, closedAt: 1 }),
    ]);
    expect(summary).toEqual({
      count: 2,
      activeCount: 1,
      closedCount: 1,
      uplinkTotal: 15n,
      downlinkTotal: 25n,
      uplinkRate: 1,
      downlinkRate: 2,
    });
  });
});

describe("collectFacetValues", () => {
  it("counts values and sorts by frequency", () => {
    const values = collectFacetValues(
      [
        makeRow({ id: "1", outbound: "a" }),
        makeRow({ id: "2", outbound: "a" }),
        makeRow({ id: "3", outbound: "b" }),
      ],
      "outbound",
    );
    expect(values).toEqual([
      { value: "a", count: 2 },
      { value: "b", count: 1 },
    ]);
  });
});

describe("trafficShare", () => {
  it("returns a percentage and guards against zero totals", () => {
    expect(trafficShare(25n, 100n)).toBe(25);
    expect(trafficShare(1n, 0n)).toBe(0);
  });
});
