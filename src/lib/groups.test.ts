import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { GroupItemSchema, GroupSchema } from "../gen/daemon/started_service_pb";
import {
  availableItemCount,
  compareGroups,
  fastestDelay,
  filterGroups,
  sortGroupItems,
  sortGroups,
} from "./groups";

function item(tag: string, delay: number, type = "vmess") {
  return create(GroupItemSchema, { tag, type, urlTestDelay: delay });
}

function group(tag: string, items: ReturnType<typeof item>[], type = "selector") {
  return create(GroupSchema, { tag, type, items });
}

describe("fastestDelay", () => {
  it("returns the smallest positive delay and ignores untested nodes", () => {
    expect(fastestDelay([item("a", 0), item("b", 320), item("c", 120)])).toBe(120);
    expect(fastestDelay([item("a", 0)])).toBe(0);
  });
});

describe("availableItemCount", () => {
  it("counts nodes with a measured delay", () => {
    expect(availableItemCount([item("a", 0), item("b", 100), item("c", 200)])).toBe(2);
  });
});

describe("sortGroupItems", () => {
  const items = [item("c", 300), item("a", 0), item("b", 100)];

  it("keeps the original order by default", () => {
    expect(sortGroupItems(items, "default").map((entry) => entry.tag)).toEqual(["c", "a", "b"]);
  });

  it("sorts by name", () => {
    expect(sortGroupItems(items, "name").map((entry) => entry.tag)).toEqual(["a", "b", "c"]);
  });

  it("sorts by latency with untested nodes last", () => {
    expect(sortGroupItems(items, "latency").map((entry) => entry.tag)).toEqual(["b", "c", "a"]);
  });

  it("sorts by type then name", () => {
    const mixed = [item("b", 0, "trojan"), item("a", 0, "trojan"), item("c", 0, "vmess")];
    expect(sortGroupItems(mixed, "type").map((entry) => entry.tag)).toEqual(["a", "b", "c"]);
  });
});

describe("sortGroups", () => {
  const groups = [
    group("z", [item("z1", 400)]),
    group("a", [item("a1", 0)]),
    group("m", [item("m1", 100)]),
  ];

  it("sorts by name", () => {
    expect(sortGroups(groups, "name").map((entry) => entry.tag)).toEqual(["a", "m", "z"]);
  });

  it("sorts by latency with untested groups last", () => {
    expect(sortGroups(groups, "latency").map((entry) => entry.tag)).toEqual(["m", "z", "a"]);
  });

  it("keeps the original order by default", () => {
    expect(sortGroups(groups, "default").map((entry) => entry.tag)).toEqual(["z", "a", "m"]);
  });

  it("exposes a comparator usable for entries", () => {
    const entries = [{ group: groups[1] }, { group: groups[0] }];
    entries.sort((left, right) => compareGroups(left.group, right.group, "name"));
    expect(entries.map((entry) => entry.group.tag)).toEqual(["a", "z"]);
  });
});

describe("filterGroups", () => {
  const groups = [
    group("Proxy", [item("us", 100), item("jp", 200)]),
    group("Auto", [item("hk", 300), item("sg", 400)]),
  ];

  it("returns every group and item when the query is empty", () => {
    const result = filterGroups(groups, "");
    expect(result).toHaveLength(2);
    expect(result[0].items).toHaveLength(2);
  });

  it("keeps all items when the group itself matches", () => {
    const result = filterGroups(groups, "proxy");
    expect(result).toHaveLength(1);
    expect(result[0].group.tag).toBe("Proxy");
    expect(result[0].items).toHaveLength(2);
  });

  it("filters items when only a node matches", () => {
    const result = filterGroups(groups, "hk");
    expect(result).toHaveLength(1);
    expect(result[0].group.tag).toBe("Auto");
    expect(result[0].items.map((entry) => entry.tag)).toEqual(["hk"]);
  });

  it("drops groups when neither the group nor a node matches", () => {
    expect(filterGroups(groups, "nope")).toEqual([]);
  });
});
