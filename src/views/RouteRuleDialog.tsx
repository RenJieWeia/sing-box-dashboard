import JSON5 from "json5";
import { useState } from "react";

import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "../components/Icon";
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Select,
  Toggle,
} from "../components/ui";
import {
  formatRuleValue,
  isJsonObject,
  MATCH_FIELDS,
  ruleAction,
  ruleOutbound,
  ruleRuleSets,
  type JsonObject,
} from "../lib/routeRules";
import { cx } from "../lib/cx";
import styles from "./RouteRuleDialog.module.css";

const FIELD_LABELS: Record<string, MessageKey> = {
  domain_suffix: "Domain suffix",
  domain_keyword: "Domain keyword",
  domain: "Domain",
  ip_cidr: "IP CIDR",
  source_ip_cidr: "Source IP CIDR",
  port: "Port",
  port_range: "Port range",
  domain_regex: "Domain regex",
  network: "Network",
  protocol: "Protocol",
  process_name: "Process name",
  process_path: "Process path",
  package_name: "Package name",
  inbound: "Inbound",
  user: "User",
  geoip: "GeoIP",
  geosite: "Geosite",
  clash_mode: "Clash mode",
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
  domain_suffix: ".example.com, .example.org",
  domain_keyword: "google, github",
  domain: "example.com",
  ip_cidr: "10.0.0.0/8, 192.168.0.0/16",
  source_ip_cidr: "192.168.0.0/16",
  port: "80, 443",
  port_range: "8000:9000",
  domain_regex: "^(.*\\.)?example\\.com$",
  network: "tcp, udp",
  protocol: "tls",
  process_name: "curl, chrome",
  process_path: "/usr/bin/curl",
  package_name: "com.example.app",
  inbound: "mixed-in",
  user: "alice",
  geoip: "cn",
  geosite: "cn",
  clash_mode: "rule",
};

const INPUT_FIELDS = MATCH_FIELDS.filter(
  (field) => field.key !== "rule_set" && field.key !== "invert",
);

const ACTION_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: "route", label: "Route" },
  { value: "reject", label: "Reject" },
  { value: "sniff", label: "Sniff" },
  { value: "hijack-dns", label: "Hijack DNS" },
  { value: "resolve", label: "Resolve" },
];

const REJECT_METHODS: { value: string; label: MessageKey }[] = [
  { value: "default", label: "Default" },
  { value: "drop", label: "Drop" },
];

interface Draft {
  action: string;
  outbound: string;
  rejectMethod: string;
  ruleSets: string[];
  invert: boolean;
  ipIsPrivate: boolean;
  fields: Record<string, string>;
  extra: JsonObject;
}

function draftFromRule(rule: JsonObject, outbounds: string[]): Draft {
  const fields: Record<string, string> = {};
  for (const field of INPUT_FIELDS) {
    const value = rule[field.key];
    if (value !== undefined && value !== null && value !== "") {
      fields[field.key] = formatRuleValue(value);
    }
  }
  const handled = new Set<string>([
    "action",
    "outbound",
    "reject_method",
    "rule_set",
    "invert",
    "ip_is_private",
    ...INPUT_FIELDS.map((field) => field.key),
  ]);
  const extra: JsonObject = {};
  for (const [key, value] of Object.entries(rule)) {
    if (!handled.has(key)) {
      extra[key] = value;
    }
  }
  const action = ruleAction(rule) || "route";
  return {
    action,
    outbound: ruleOutbound(rule) || outbounds[0] || "",
    rejectMethod: typeof rule.reject_method === "string" ? rule.reject_method : "default",
    ruleSets: ruleRuleSets(rule),
    invert: rule.invert === true,
    ipIsPrivate: rule.ip_is_private === true,
    fields,
    extra,
  };
}

function splitValues(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function parseFieldValue(key: string, text: string): unknown {
  const values = splitValues(text);
  if (values.length === 0) {
    return undefined;
  }
  if (key === "port") {
    const ports = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (ports.length === 0) {
      return undefined;
    }
    return ports.length === 1 ? ports[0] : ports;
  }
  if (key === "protocol" || key === "geoip" || key === "geosite" || key === "clash_mode") {
    return values.length === 1 ? values[0] : values;
  }
  return values;
}

function buildRule(draft: Draft): JsonObject {
  const rule: JsonObject = { ...draft.extra, action: draft.action };
  if (draft.action === "route") {
    rule.outbound = draft.outbound;
  }
  if (draft.action === "reject" && draft.rejectMethod !== "default") {
    rule.reject_method = draft.rejectMethod;
  }
  if (draft.ruleSets.length > 0) {
    rule.rule_set = [...draft.ruleSets];
  }
  if (draft.invert) {
    rule.invert = true;
  }
  if (draft.ipIsPrivate) {
    rule.ip_is_private = true;
  }
  for (const field of INPUT_FIELDS) {
    const text = draft.fields[field.key];
    if (text === undefined || text.trim() === "") {
      continue;
    }
    const value = parseFieldValue(field.key, text);
    if (value !== undefined) {
      rule[field.key] = value;
    }
  }
  return rule;
}

export function RouteRuleDialog(props: {
  initial: JsonObject | null;
  outbounds: string[];
  ruleSets: string[];
  onSave: (rule: JsonObject) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"visual" | "json">("visual");
  const [draft, setDraft] = useState<Draft>(() =>
    draftFromRule(props.initial ?? { action: "route" }, props.outbounds),
  );
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(buildRule(draftFromRule(props.initial ?? { action: "route" }, props.outbounds)), null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [addField, setAddField] = useState("");

  const activeFields = INPUT_FIELDS.filter((field) => draft.fields[field.key] !== undefined);
  const outboundOptions =
    draft.outbound !== "" && !props.outbounds.includes(draft.outbound)
      ? [draft.outbound, ...props.outbounds]
      : props.outbounds;
  const knownRuleSets = new Set(props.ruleSets);
  const ruleSetOptions = [
    ...props.ruleSets,
    ...draft.ruleSets.filter((tag) => !knownRuleSets.has(tag)),
  ];
  const actionOptions = ACTION_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.label),
  }));
  if (draft.action !== "" && !actionOptions.some((option) => option.value === draft.action)) {
    actionOptions.unshift({ value: draft.action, label: draft.action });
  }
  const rejectOptions = REJECT_METHODS.map((option) => ({
    value: option.value,
    label: t(option.label),
  }));
  if (!rejectOptions.some((option) => option.value === draft.rejectMethod)) {
    rejectOptions.unshift({ value: draft.rejectMethod, label: draft.rejectMethod });
  }

  const updateDraft = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const toggleRuleSet = (tag: string) => {
    setDraft((current) => ({
      ...current,
      ruleSets: current.ruleSets.includes(tag)
        ? current.ruleSets.filter((entry) => entry !== tag)
        : [...current.ruleSets, tag],
    }));
  };

  const addCondition = (key: string) => {
    if (key === "") {
      return;
    }
    setDraft((current) => ({ ...current, fields: { ...current.fields, [key]: "" } }));
    setAddField("");
  };

  const removeCondition = (key: string) => {
    setDraft((current) => {
      const fields = { ...current.fields };
      delete fields[key];
      return { ...current, fields };
    });
  };

  const switchTab = (next: "visual" | "json") => {
    if (next === tab) {
      return;
    }
    if (next === "json") {
      setJsonText(JSON.stringify(buildRule(draft), null, 2));
      setError(null);
      setTab("json");
      return;
    }
    try {
      const parsed: unknown = JSON5.parse(jsonText);
      if (!isJsonObject(parsed)) {
        throw new Error(t("Configuration must be a JSON object."));
      }
      setDraft(draftFromRule(parsed, props.outbounds));
      setError(null);
      setTab("visual");
    } catch (caught) {
      setError(t("Invalid JSON: {message}", { message: caught instanceof Error ? caught.message : String(caught) }));
    }
  };

  const save = () => {
    let rule: JsonObject;
    if (tab === "json") {
      try {
        const parsed: unknown = JSON5.parse(jsonText);
        if (!isJsonObject(parsed)) {
          throw new Error(t("Configuration must be a JSON object."));
        }
        rule = parsed;
      } catch (caught) {
        setError(t("Invalid JSON: {message}", { message: caught instanceof Error ? caught.message : String(caught) }));
        return;
      }
    } else {
      rule = buildRule(draft);
    }
    if ((ruleAction(rule) || "route") === "route" && ruleOutbound(rule) === "") {
      setError(t("Action requires an outbound"));
      return;
    }
    props.onSave(rule);
  };

  const unusedFields = INPUT_FIELDS.filter(
    (field) => draft.fields[field.key] === undefined,
  );

  return (
    <Dialog onClose={props.onClose} className={styles.ruleDialog}>
      <h3>{props.initial === null ? t("Add rule") : t("Edit rule")}</h3>
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={tab === "visual" ? "active" : ""}
          onClick={() => switchTab("visual")}
        >
          {t("Visual")}
        </button>
        <button
          type="button"
          className={tab === "json" ? "active" : ""}
          onClick={() => switchTab("json")}
        >
          {t("JSON")}
        </button>
      </div>

      {tab === "visual" ? (
        <>
          <div className={styles.fieldGrid}>
            <Field label={t("Action")}>
              <Select
                options={actionOptions}
                value={draft.action}
                onChange={(action) => updateDraft({ action })}
              />
            </Field>
            {draft.action === "route" && (
              <Field label={t("Outbound")}>
                {props.outbounds.length > 0 ? (
                  <Select
                    options={outboundOptions.map((tag) => ({ value: tag, label: tag }))}
                    value={draft.outbound}
                    onChange={(outbound) => updateDraft({ outbound })}
                  />
                ) : (
                  <input
                    className="input"
                    value={draft.outbound}
                    onChange={(event) => updateDraft({ outbound: event.target.value })}
                  />
                )}
              </Field>
            )}
            {draft.action === "reject" && (
              <Field label={t("Reject method")}>
                <Select
                  options={rejectOptions}
                  value={draft.rejectMethod}
                  onChange={(rejectMethod) => updateDraft({ rejectMethod })}
                />
              </Field>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>{t("Rule sets")}</span>
              {ruleSetOptions.length === 0 && <span className="hint">{t("No data")}</span>}
            </div>
            {ruleSetOptions.length > 0 && (
              <div className={styles.chips}>
                {ruleSetOptions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={cx(styles.chip, draft.ruleSets.includes(tag) && styles.chipActive)}
                    onClick={() => toggleRuleSet(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>{t("Match conditions")}</span>
              <Select
                inline
                options={unusedFields.map((field) => ({
                  value: field.key,
                  label: t(FIELD_LABELS[field.key] ?? "Rule"),
                }))}
                value={addField}
                onChange={addCondition}
                placeholder={t("Add condition")}
              />
            </div>
            {activeFields.length === 0 ? (
              <p className="hint">{t("Add condition")}</p>
            ) : (
              <div className={styles.conditions}>
                {activeFields.map((field) => (
                  <div key={field.key} className={styles.conditionRow}>
                    <span className={styles.conditionLabel}>
                      {t(FIELD_LABELS[field.key] ?? "Rule")}
                    </span>
                    <input
                      className="input"
                      value={draft.fields[field.key] ?? ""}
                      placeholder={FIELD_PLACEHOLDERS[field.key] ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          fields: { ...current.fields, [field.key]: event.target.value },
                        }))
                      }
                    />
                    <IconButton
                      title={t("Remove condition")}
                      onClick={() => removeCondition(field.key)}
                    >
                      <Icon name="close" size={13} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <Toggle
              label={t("Invert match")}
              value={draft.invert}
              onChange={(invert) => updateDraft({ invert })}
            />
            <Toggle
              label={t("Private IP")}
              value={draft.ipIsPrivate}
              onChange={(ipIsPrivate) => updateDraft({ ipIsPrivate })}
            />
          </div>
        </>
      ) : (
        <div className={styles.jsonPanel}>
          <textarea
            className={styles.jsonInput}
            value={jsonText}
            spellCheck={false}
            onChange={(event) => setJsonText(event.target.value)}
          />
          <p className="hint">{t("JSON")}5 / JSON</p>
        </div>
      )}

      {error !== null && <div className="banner error">{error}</div>}

      <div className="row-actions dialog-actions">
        <Button onClick={props.onClose}>{t("Cancel")}</Button>
        <Button variant="primary" onClick={save}>
          {t("Save")}
        </Button>
      </div>
    </Dialog>
  );
}
