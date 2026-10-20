import type { ConnectionRow } from "../api/daemon";
import type { Connection } from "../gen/daemon/started_service_pb";

export type ConnectionStateFilter = "all" | "active" | "closed";
export type ConnectionTimeWindow = "all" | "1m" | "5m" | "1h" | "24h";
export type SortDirection = "asc" | "desc";
export type TrafficDimension =
  | "outbound"
  | "inbound"
  | "rule"
  | "domain"
  | "network"
  | "protocol"
  | "process"
  | "source";
export type ConnectionSortMode =
  | "date"
  | "traffic"
  | "trafficTotal"
  | "upload"
  | "download"
  | "duration"
  | "destination";
export type TrafficGroupSortMode = "traffic" | "rate" | "count" | "name";

export const TRAFFIC_DIMENSIONS: TrafficDimension[] = [
  "outbound",
  "inbound",
  "rule",
  "domain",
  "network",
  "protocol",
  "process",
  "source",
];

export const CONNECTION_SORT_MODES: ConnectionSortMode[] = [
  "date",
  "traffic",
  "trafficTotal",
  "upload",
  "download",
  "duration",
  "destination",
];

export const TRAFFIC_GROUP_SORT_MODES: TrafficGroupSortMode[] = [
  "traffic",
  "rate",
  "count",
  "name",
];

export const CONNECTION_STATES: ConnectionStateFilter[] = ["active", "all", "closed"];

export const CONNECTION_TIME_WINDOWS: ConnectionTimeWindow[] = ["all", "1m", "5m", "1h", "24h"];

const TIME_WINDOW_MS: Record<Exclude<ConnectionTimeWindow, "all">, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "1h": 3_600_000,
  "24h": 86_400_000,
};

export interface ConnectionFilters {
  state: ConnectionStateFilter;
  network: string;
  sourceIp: string;
  inbound: string;
  outbound: string;
  rule: string;
  process: string;
  protocol: string;
  window: ConnectionTimeWindow;
}

export const DEFAULT_CONNECTION_FILTERS: ConnectionFilters = {
  state: "active",
  network: "",
  sourceIp: "",
  inbound: "",
  outbound: "",
  rule: "",
  process: "",
  protocol: "",
  window: "all",
};

export function connectionHost(connection: Connection): string {
  return connection.domain !== "" ? connection.domain : connection.destination;
}

export function connectionSourceIp(connection: Connection): string {
  const value = connection.source.trim();
  if (value === "") {
    return "";
  }
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end > 1) {
      return value.slice(1, end);
    }
  }
  const firstColon = value.indexOf(":");
  const lastColon = value.lastIndexOf(":");
  if (firstColon > 0 && firstColon === lastColon) {
    const host = value.slice(0, lastColon);
    const port = value.slice(lastColon + 1);
    if (port !== "" && /^\d+$/.test(port)) {
      return host;
    }
  }
  return value;
}

export function connectionProcess(connection: Connection): string {
  const info = connection.processInfo;
  if (!info) {
    return "";
  }
  if (info.processPath !== "") {
    const parts = info.processPath.split(/[\\/]/).filter((part) => part !== "");
    return parts[parts.length - 1] ?? info.processPath;
  }
  if (info.packageNames.length > 0) {
    return info.packageNames[0];
  }
  if (info.userName !== "") {
    return info.userName;
  }
  return info.processId > 0 ? `pid ${info.processId}` : "";
}

export function connectionDimensionValue(
  connection: Connection,
  dimension: TrafficDimension,
): string {
  switch (dimension) {
    case "outbound":
      return connection.outbound;
    case "inbound":
      return connection.inbound;
    case "rule":
      return connection.rule;
    case "domain":
      return connectionHost(connection);
    case "network":
      return connection.network.toUpperCase();
    case "protocol":
      return connection.protocol;
    case "process":
      return connectionProcess(connection);
    case "source":
      return connectionSourceIp(connection);
  }
}

export function matchesConnectionState(row: ConnectionRow, state: ConnectionStateFilter): boolean {
  if (state === "active") {
    return row.closedAt === null;
  }
  if (state === "closed") {
    return row.closedAt !== null;
  }
  return true;
}

export function matchesTimeWindow(
  row: ConnectionRow,
  window: ConnectionTimeWindow,
  now: number,
): boolean {
  if (window === "all" || row.closedAt === null) {
    return true;
  }
  return row.closedAt >= now - TIME_WINDOW_MS[window];
}

export function matchesConnectionFilters(
  row: ConnectionRow,
  filters: ConnectionFilters,
  now: number,
): boolean {
  if (!matchesConnectionState(row, filters.state)) {
    return false;
  }
  if (!matchesTimeWindow(row, filters.window, now)) {
    return false;
  }
  const connection = row.connection;
  if (filters.network !== "" && connection.network.toLowerCase() !== filters.network.toLowerCase()) {
    return false;
  }
  if (filters.sourceIp !== "" && connectionSourceIp(connection) !== filters.sourceIp) {
    return false;
  }
  if (filters.inbound !== "" && connection.inbound !== filters.inbound) {
    return false;
  }
  if (filters.outbound !== "" && connection.outbound !== filters.outbound) {
    return false;
  }
  if (filters.rule !== "" && connection.rule !== filters.rule) {
    return false;
  }
  if (filters.process !== "" && connectionProcess(connection) !== filters.process) {
    return false;
  }
  if (filters.protocol !== "" && connection.protocol !== filters.protocol) {
    return false;
  }
  return true;
}

interface SearchField {
  key: string;
  match: (connection: Connection, value: string) => boolean;
}

const SEARCH_FIELDS: SearchField[] = [
  { key: "network", match: (connection, value) => connection.network.toLowerCase() === value },
  { key: "inbound", match: (connection, value) => connection.inbound.toLowerCase().includes(value) },
  {
    key: "inbound.type",
    match: (connection, value) => connection.inboundType.toLowerCase().includes(value),
  },
  { key: "source", match: (connection, value) => connection.source.toLowerCase().includes(value) },
  {
    key: "source_ip",
    match: (connection, value) => connectionSourceIp(connection).toLowerCase().includes(value),
  },
  {
    key: "destination",
    match: (connection, value) => connection.destination.toLowerCase().includes(value),
  },
  { key: "domain", match: (connection, value) => connection.domain.toLowerCase().includes(value) },
  { key: "outbound", match: (connection, value) => connection.outbound.toLowerCase().includes(value) },
  {
    key: "outbound.type",
    match: (connection, value) => connection.outboundType.toLowerCase().includes(value),
  },
  { key: "rule", match: (connection, value) => connection.rule.toLowerCase().includes(value) },
  { key: "process", match: (connection, value) => connectionProcess(connection).toLowerCase().includes(value) },
  { key: "protocol", match: (connection, value) => connection.protocol.toLowerCase().includes(value) },
  { key: "user", match: (connection, value) => connection.user.toLowerCase().includes(value) },
  {
    key: "chain",
    match: (connection, value) => connection.chainList.join(" ").toLowerCase().includes(value),
  },
];

export function matchesConnectionSearch(row: ConnectionRow, search: string): boolean {
  const query = search.trim();
  if (query === "") {
    return true;
  }
  for (const rawToken of query.split(/\s+/)) {
    let token = rawToken;
    let negate = false;
    if (token.length > 1 && token.startsWith("-")) {
      negate = true;
      token = token.slice(1);
    }
    const matched = matchesSearchToken(row.connection, token);
    if (matched === negate) {
      return false;
    }
  }
  return true;
}

function matchesSearchToken(connection: Connection, token: string): boolean {
  const separator = token.indexOf(":");
  if (separator > 0) {
    const key = token.slice(0, separator).toLowerCase();
    const value = token.slice(separator + 1).toLowerCase();
    const field = SEARCH_FIELDS.find((entry) => entry.key === key);
    if (field) {
      return field.match(connection, value);
    }
  }
  return matchesPlainSearch(connection, token.toLowerCase());
}

function matchesPlainSearch(connection: Connection, query: string): boolean {
  return (
    connection.destination.toLowerCase().includes(query) ||
    connection.domain.toLowerCase().includes(query) ||
    connection.source.toLowerCase().includes(query) ||
    connection.outbound.toLowerCase().includes(query) ||
    connection.rule.toLowerCase().includes(query) ||
    connectionProcess(connection).toLowerCase().includes(query)
  );
}

export interface TrafficGroup {
  key: string;
  count: number;
  activeCount: number;
  uplinkTotal: bigint;
  downlinkTotal: bigint;
  uplinkRate: number;
  downlinkRate: number;
}

export function groupTraffic(
  rows: Iterable<ConnectionRow>,
  dimension: TrafficDimension,
): TrafficGroup[] {
  const groups = new Map<string, TrafficGroup>();
  for (const row of rows) {
    const key = connectionDimensionValue(row.connection, dimension);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        count: 0,
        activeCount: 0,
        uplinkTotal: 0n,
        downlinkTotal: 0n,
        uplinkRate: 0,
        downlinkRate: 0,
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (row.closedAt === null) {
      group.activeCount += 1;
    }
    group.uplinkTotal += row.uplinkTotal;
    group.downlinkTotal += row.downlinkTotal;
    group.uplinkRate += row.uplinkRate;
    group.downlinkRate += row.downlinkRate;
  }
  return [...groups.values()];
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function sortTrafficGroups(
  groups: TrafficGroup[],
  mode: TrafficGroupSortMode,
  direction: SortDirection,
): TrafficGroup[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...groups].sort((left, right) => {
    let result: number;
    switch (mode) {
      case "name":
        result = left.key.localeCompare(right.key);
        break;
      case "rate":
        result = left.uplinkRate + left.downlinkRate - (right.uplinkRate + right.downlinkRate);
        break;
      case "count":
        result = left.count - right.count;
        break;
      default:
        result = compareBigInt(left.uplinkTotal + left.downlinkTotal, right.uplinkTotal + right.downlinkTotal);
        break;
    }
    return result === 0 ? left.key.localeCompare(right.key) : result * sign;
  });
}

function rowTotal(row: ConnectionRow): bigint {
  return row.uplinkTotal + row.downlinkTotal;
}

function rowDuration(row: ConnectionRow, now: number): number {
  const createdAt = Number(row.connection.createdAt);
  return (row.closedAt ?? now) - createdAt;
}

export function sortConnectionRows(
  rows: ConnectionRow[],
  mode: ConnectionSortMode,
  direction: SortDirection,
  now: number,
): ConnectionRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    let result: number;
    switch (mode) {
      case "traffic":
        result = left.uplinkRate + left.downlinkRate - (right.uplinkRate + right.downlinkRate);
        break;
      case "trafficTotal":
        result = compareBigInt(rowTotal(left), rowTotal(right));
        break;
      case "upload":
        result = compareBigInt(left.uplinkTotal, right.uplinkTotal);
        break;
      case "download":
        result = compareBigInt(left.downlinkTotal, right.downlinkTotal);
        break;
      case "duration":
        result = rowDuration(left, now) - rowDuration(right, now);
        break;
      case "destination":
        result = connectionHost(left.connection).localeCompare(connectionHost(right.connection));
        break;
      default:
        result =
          Number(left.connection.createdAt) - Number(right.connection.createdAt);
        break;
    }
    if (result !== 0) {
      return result * sign;
    }
    return Number(right.connection.createdAt) - Number(left.connection.createdAt);
  });
}

export interface TrafficSummary {
  count: number;
  activeCount: number;
  closedCount: number;
  uplinkTotal: bigint;
  downlinkTotal: bigint;
  uplinkRate: number;
  downlinkRate: number;
}

export function summarizeTraffic(rows: Iterable<ConnectionRow>): TrafficSummary {
  const summary: TrafficSummary = {
    count: 0,
    activeCount: 0,
    closedCount: 0,
    uplinkTotal: 0n,
    downlinkTotal: 0n,
    uplinkRate: 0,
    downlinkRate: 0,
  };
  for (const row of rows) {
    summary.count += 1;
    if (row.closedAt === null) {
      summary.activeCount += 1;
    } else {
      summary.closedCount += 1;
    }
    summary.uplinkTotal += row.uplinkTotal;
    summary.downlinkTotal += row.downlinkTotal;
    summary.uplinkRate += row.uplinkRate;
    summary.downlinkRate += row.downlinkRate;
  }
  return summary;
}

export interface FacetValue {
  value: string;
  count: number;
}

export function collectFacetValues(
  rows: Iterable<ConnectionRow>,
  dimension: TrafficDimension,
  limit = 60,
): FacetValue[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = connectionDimensionValue(row.connection, dimension);
    if (value === "") {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, limit);
}

export function trafficShare(value: bigint, total: bigint): number {
  if (total <= 0n) {
    return 0;
  }
  return Number(value) / Number(total) * 100;
}

export function filterConnections(
  rows: Iterable<ConnectionRow>,
  filters: ConnectionFilters,
  search: string,
  now: number,
): ConnectionRow[] {
  const result: ConnectionRow[] = [];
  for (const row of rows) {
    if (!matchesConnectionFilters(row, filters, now)) {
      continue;
    }
    if (!matchesConnectionSearch(row, search)) {
      continue;
    }
    result.push(row);
  }
  return result;
}
