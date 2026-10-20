import { describe, expect, it } from "vitest";

import {
  applyFinalOutbound,
  applyRules,
  cloneRule,
  formatRuleValue,
  moveRule,
  parseRouteConfig,
  ruleAction,
  ruleMatchEntries,
  ruleMatchesSearch,
  ruleOutbound,
  ruleRuleSets,
  serializeRouteConfig,
} from "./routeRules";

const CONFIG = `{
  // A commented config with a trailing comma.
  "outbounds": [{ "tag": "direct" }, { "tag": "proxy" }],
  "route": {
    "final": "proxy",
    "rule_set": [{ "tag": "cn" }, { "tag": "ads" }],
    "rules": [
      { "action": "route", "outbound": "direct", "rule_set": ["cn"] },
      { "action": "reject", "rule_set": ["ads"] },
      { "outbound": "proxy", "domain_suffix": [".example.com"] },
    ],
  },
}`;

describe("parseRouteConfig", () => {
  it("parses JSON5, rules, outbounds, rule sets and final outbound", () => {
    const data = parseRouteConfig(CONFIG);
    expect(data.rules).toHaveLength(3);
    expect(data.outbounds).toEqual(["direct", "proxy"]);
    expect(data.ruleSets).toEqual(["cn", "ads"]);
    expect(data.finalOutbound).toBe("proxy");
  });

  it("rejects non-object roots", () => {
    expect(() => parseRouteConfig("[]")).toThrow("JSON object");
  });
});

describe("rule helpers", () => {
  it("derives action, outbound and rule sets", () => {
    expect(ruleAction({ action: "reject" })).toBe("reject");
    expect(ruleAction({ outbound: "proxy" })).toBe("route");
    expect(ruleOutbound({ outbound: "proxy" })).toBe("proxy");
    expect(ruleRuleSets({ rule_set: ["cn", "ads"] })).toEqual(["cn", "ads"]);
    expect(ruleRuleSets({ rule_set: "cn" })).toEqual(["cn"]);
  });

  it("formats match entries without non-match keys", () => {
    const entries = ruleMatchEntries({
      action: "route",
      outbound: "direct",
      rule_set: ["cn"],
      domain_suffix: [".example.com", ".example.org"],
      invert: true,
      port: [80, 443],
    });
    expect(entries).toEqual([
      { key: "domain_suffix", value: ".example.com, .example.org" },
      { key: "port", value: "80, 443" },
    ]);
  });

  it("searches rules by their JSON representation", () => {
    expect(ruleMatchesSearch({ domain_suffix: [".example.com"] }, "example")).toBe(true);
    expect(ruleMatchesSearch({ domain_suffix: [".example.com"] }, "nope")).toBe(false);
    expect(ruleMatchesSearch({ domain_suffix: [".example.com"] }, "")).toBe(true);
  });

  it("formats nested values", () => {
    expect(formatRuleValue(["a", 1, true])).toBe("a, 1, true");
    expect(formatRuleValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("config mutations", () => {
  it("applies rules while preserving other route fields", () => {
    const data = parseRouteConfig(CONFIG);
    const next = applyRules(data.config, [{ action: "sniff" }]);
    expect(next.route).toMatchObject({ final: "proxy", rules: [{ action: "sniff" }] });
    expect(next.outbounds).toHaveLength(2);
  });

  it("applies the final outbound", () => {
    const data = parseRouteConfig(CONFIG);
    const next = applyFinalOutbound(data.config, "direct");
    expect((next.route as { final: string }).final).toBe("direct");
  });

  it("serializes as formatted JSON", () => {
    const text = serializeRouteConfig({ a: 1 });
    expect(text).toBe('{\n  "a": 1\n}\n');
  });
});

describe("moving and cloning", () => {
  const rules = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("moves a rule", () => {
    expect(moveRule(rules, 0, 2).map((rule) => rule.id)).toEqual(["b", "c", "a"]);
    expect(moveRule(rules, 2, 0).map((rule) => rule.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores out-of-range moves", () => {
    expect(moveRule(rules, -1, 1)).toBe(rules);
    expect(moveRule(rules, 0, 9)).toBe(rules);
  });

  it("clones rules deeply", () => {
    const source = { nested: { value: 1 } };
    const copy = cloneRule(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
  });
});
