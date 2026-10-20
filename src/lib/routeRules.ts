import JSON5 from "json5";

export type JsonObject = Record<string, unknown>;

export const RULE_ACTIONS = ["route", "reject", "sniff", "hijack-dns", "resolve"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number] | string;

export const MATCH_FIELDS = [
  { key: "rule_set", label: "Rule set", kind: "rule-set" },
  { key: "domain_suffix", label: "Domain suffix", kind: "list" },
  { key: "domain_keyword", label: "Domain keyword", kind: "list" },
  { key: "domain", label: "Domain", kind: "list" },
  { key: "ip_cidr", label: "IP CIDR", kind: "list" },
  { key: "source_ip_cidr", label: "Source IP CIDR", kind: "list" },
  { key: "port", label: "Port", kind: "port" },
  { key: "port_range", label: "Port range", kind: "list" },
  { key: "domain_regex", label: "Domain regex", kind: "list" },
  { key: "network", label: "Network", kind: "list" },
  { key: "protocol", label: "Protocol", kind: "text" },
  { key: "process_name", label: "Process name", kind: "list" },
  { key: "process_path", label: "Process path", kind: "list" },
  { key: "package_name", label: "Package name", kind: "list" },
  { key: "inbound", label: "Inbound", kind: "list" },
  { key: "user", label: "User", kind: "list" },
  { key: "geoip", label: "GeoIP", kind: "text" },
  { key: "geosite", label: "Geosite", kind: "text" },
  { key: "clash_mode", label: "Clash mode", kind: "text" },
  { key: "invert", label: "Invert", kind: "boolean" },
] as const;

export type MatchFieldKey = (typeof MATCH_FIELDS)[number]["key"];

const NON_MATCH_KEYS = new Set(["action", "outbound", "reject_method", "rule_set", "invert"]);

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface RouteConfigData {
  config: JsonObject;
  route: JsonObject;
  rules: JsonObject[];
  ruleSets: string[];
  outbounds: string[];
  finalOutbound: string;
}

export function parseRouteConfig(text: string): RouteConfigData {
  const parsed: unknown = JSON5.parse(text.replace(/^\uFEFF/, ""));
  if (!isJsonObject(parsed)) {
    throw new Error("Configuration must be a JSON object.");
  }
  const route = isJsonObject(parsed.route) ? parsed.route : {};
  const rules = Array.isArray(route.rules) ? route.rules.filter(isJsonObject) : [];
  const ruleSets = Array.isArray(route.rule_set)
    ? route.rule_set
        .filter(isJsonObject)
        .map((entry) => (typeof entry.tag === "string" ? entry.tag : ""))
        .filter((tag) => tag !== "")
    : [];
  const outbounds = Array.isArray(parsed.outbounds)
    ? parsed.outbounds
        .filter(isJsonObject)
        .map((entry) => (typeof entry.tag === "string" ? entry.tag : ""))
        .filter((tag) => tag !== "")
    : [];
  return {
    config: parsed,
    route,
    rules,
    ruleSets,
    outbounds,
    finalOutbound: typeof route.final === "string" ? route.final : "",
  };
}

export function applyRules(config: JsonObject, rules: JsonObject[]): JsonObject {
  const route = isJsonObject(config.route) ? config.route : {};
  return { ...config, route: { ...route, rules } };
}

export function applyFinalOutbound(config: JsonObject, finalOutbound: string): JsonObject {
  const route = isJsonObject(config.route) ? config.route : {};
  return { ...config, route: { ...route, final: finalOutbound } };
}

export function serializeRouteConfig(config: JsonObject): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function ruleAction(rule: JsonObject): string {
  if (typeof rule.action === "string" && rule.action !== "") {
    return rule.action;
  }
  return typeof rule.outbound === "string" ? "route" : "";
}

export function ruleOutbound(rule: JsonObject): string {
  return typeof rule.outbound === "string" ? rule.outbound : "";
}

export function ruleRuleSets(rule: JsonObject): string[] {
  if (Array.isArray(rule.rule_set)) {
    return rule.rule_set.filter((value): value is string => typeof value === "string");
  }
  return typeof rule.rule_set === "string" ? [rule.rule_set] : [];
}

export interface RuleMatchEntry {
  key: string;
  value: string;
}

export function ruleMatchEntries(rule: JsonObject): RuleMatchEntry[] {
  const entries: RuleMatchEntry[] = [];
  for (const [key, value] of Object.entries(rule)) {
    if (NON_MATCH_KEYS.has(key)) {
      continue;
    }
    if (value === undefined || value === null || value === "") {
      continue;
    }
    entries.push({ key, value: formatRuleValue(value) });
  }
  return entries;
}

export function formatRuleValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => formatRuleValue(entry)).join(", ");
  }
  if (isJsonObject(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function ruleMatchesSearch(rule: JsonObject, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") {
    return true;
  }
  return JSON.stringify(rule).toLowerCase().includes(query);
}

export function cloneRule(rule: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(rule)) as JsonObject;
}

export function moveRule(rules: JsonObject[], from: number, to: number): JsonObject[] {
  if (from === to || from < 0 || to < 0 || from >= rules.length || to >= rules.length) {
    return rules;
  }
  const next = [...rules];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function ruleMatchField(rule: JsonObject, key: MatchFieldKey): unknown {
  return rule[key];
}
