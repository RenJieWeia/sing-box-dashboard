import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeError } from "../api/stream";
import { useNavigationGuard } from "../app/context";
import {
  useDesktopHost,
  type DesktopHost,
  type DesktopProfilesState,
} from "../app/desktop";
import { showError } from "../app/errorStore";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StatGrid } from "../components/StatGrid";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  MenuItem,
  OthersMenu,
  SearchInput,
  Select,
  Spinner,
  type BadgeTone,
} from "../components/ui";
import { csvTimestamp, downloadText } from "../lib/csv";
import {
  applyFinalOutbound,
  applyRules,
  cloneRule,
  moveRule,
  parseRouteConfig,
  ruleAction,
  ruleMatchEntries,
  ruleMatchesSearch,
  ruleOutbound,
  ruleRuleSets,
  serializeRouteConfig,
  type JsonObject,
  type RouteConfigData,
} from "../lib/routeRules";
import { RouteRuleDialog } from "./RouteRuleDialog";
import styles from "./RoutingView.module.css";

type RoutingSource =
  | { kind: "profile"; id: string }
  | { kind: "file"; name: string }
  | null;

interface RuleEditorState {
  index: number | null;
  rule: JsonObject | null;
}

const ACTION_LABELS: Record<string, MessageKey> = {
  route: "Route",
  reject: "Reject",
  sniff: "Sniff",
  "hijack-dns": "Hijack DNS",
  resolve: "Resolve",
};

const RULE_FIELD_LABELS: Record<string, MessageKey> = {
  rule_set: "Rule set",
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
  ip_is_private: "Private IP",
};

function actionTone(action: string): BadgeTone {
  switch (action) {
    case "route":
      return "accent";
    case "reject":
      return "danger";
    case "sniff":
      return "info";
    case "hijack-dns":
      return "medium";
    default:
      return "neutral";
  }
}

function useRoutingProfiles(host: DesktopHost | null): DesktopProfilesState {
  const [state, setState] = useState<DesktopProfilesState>({
    selectedId: null,
    profiles: [],
  });

  useEffect(() => {
    if (host === null) {
      setState({ selectedId: null, profiles: [] });
      return;
    }
    let stale = false;
    let sequence = 0;
    const reload = () => {
      const token = ++sequence;
      host.profiles
        .list()
        .then((value) => {
          if (!stale && token === sequence) {
            setState(value);
          }
        })
        .catch(showError);
    };
    reload();
    const unsubscribe = host.profiles.onChanged(reload);
    return () => {
      stale = true;
      unsubscribe();
    };
  }, [host]);

  return state;
}

export function RoutingView() {
  const host = useDesktopHost();
  const { t } = useI18n();
  const profiles = useRoutingProfiles(host);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [source, setSource] = useState<RoutingSource>(null);
  const [data, setData] = useState<RouteConfigData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<RuleEditorState | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadSequence = useRef(0);

  const runOrConfirm = (action: () => void) => {
    if (dirty) {
      setPendingAction(() => action);
    } else {
      action();
    }
  };

  useNavigationGuard(dirty, (proceed) => {
    setPendingAction(() => proceed);
  });

  const applyText = useCallback((text: string, nextSource: RoutingSource) => {
    setSource(nextSource);
    setDirty(false);
    setNotice(null);
    try {
      const parsed = parseRouteConfig(text);
      setData(parsed);
      setError(null);
    } catch (caught) {
      setData(null);
      setError(describeError(caught).message);
    }
  }, []);

  const loadProfile = useCallback(
    async (id: string) => {
      if (host === null) {
        return;
      }
      const sequence = ++loadSequence.current;
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const text = await host.profiles.readContent(id);
        if (sequence !== loadSequence.current) {
          return;
        }
        applyText(text, { kind: "profile", id });
      } catch (caught) {
        if (sequence !== loadSequence.current) {
          return;
        }
        setData(null);
        setSource(null);
        setError(describeError(caught).message);
        showError(caught);
      } finally {
        if (sequence === loadSequence.current) {
          setLoading(false);
        }
      }
    },
    [host, applyText],
  );

  useEffect(() => {
    if (host === null || source !== null || profileId !== null) {
      return;
    }
    const id = profiles.selectedId ?? profiles.profiles[0]?.id ?? null;
    if (id === null) {
      return;
    }
    setProfileId(id);
    void loadProfile(id);
  }, [host, profiles, source, profileId, loadProfile]);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const rules = useMemo(() => data?.rules ?? [], [data]);
  const filteredRules = useMemo(
    () =>
      rules
        .map((rule, index) => ({ rule, index }))
        .filter((entry) => ruleMatchesSearch(entry.rule, search)),
    [rules, search],
  );
  const routeCount = rules.filter((rule) => ruleAction(rule) === "route").length;
  const rejectCount = rules.filter((rule) => ruleAction(rule) === "reject").length;
  const selectedProfile =
    profileId === null ? null : (profiles.profiles.find((entry) => entry.id === profileId) ?? null);
  const content = useMemo(
    () => (data === null ? "" : serializeRouteConfig(data.config)),
    [data],
  );
  const sourceName =
    source === null
      ? ""
      : source.kind === "file"
        ? source.name
        : (selectedProfile?.name.trim() ?? "") !== ""
          ? selectedProfile?.name ?? source.id
          : source.id;

  const chooseProfile = (id: string) => {
    if (id === "") {
      return;
    }
    runOrConfirm(() => {
      setProfileId(id);
      void loadProfile(id);
    });
  };

  const reloadProfile = () => {
    if (profileId === null) {
      return;
    }
    runOrConfirm(() => {
      void loadProfile(profileId);
    });
  };

  const pickFile = () => fileInputRef.current?.click();

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      runOrConfirm(() => {
        loadSequence.current += 1;
        setLoading(false);
        setProfileId(null);
        applyText(text, { kind: "file", name: file.name });
      });
    } catch (caught) {
      showError(caught);
    }
  };

  const changeRules = (nextRules: JsonObject[]) => {
    if (data === null) {
      return;
    }
    setData({
      ...data,
      config: applyRules(data.config, nextRules),
      rules: nextRules,
    });
    setDirty(true);
    setNotice(null);
  };

  const changeFinalOutbound = (finalOutbound: string) => {
    if (data === null) {
      return;
    }
    setData({
      ...data,
      config: applyFinalOutbound(data.config, finalOutbound),
      finalOutbound,
    });
    setDirty(true);
    setNotice(null);
  };

  const save = async () => {
    if (host === null || data === null || source?.kind !== "profile") {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await host.configuration.check(content);
      await host.profiles.writeContent(source.id, content);
      setDirty(false);
      setNotice(t("Saved"));
    } catch (caught) {
      setError(describeError(caught).message);
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    if (host === null || data === null) {
      return;
    }
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      await host.configuration.check(content);
      setNotice(t("Configuration is valid"));
    } catch (caught) {
      setError(describeError(caught).message);
      showError(caught);
    } finally {
      setChecking(false);
    }
  };

  const download = () => {
    if (data === null) {
      return;
    }
    const fileName =
      source?.kind === "file"
        ? `${source.name.replace(/\.(json5?|conf)$/i, "")}.json`
        : `routing-${csvTimestamp()}.json`;
    downloadText(fileName, content, "application/json");
  };

  const copy = () => {
    if (data === null) {
      return;
    }
    if (!navigator.clipboard) {
      showError(new Error("Clipboard is not available"));
      return;
    }
    void navigator.clipboard.writeText(content).then(
      () => setNotice(t("Copied")),
      showError,
    );
  };

  const saveRule = (rule: JsonObject) => {
    if (data === null || editor === null) {
      return;
    }
    const nextRules = [...data.rules];
    if (editor.index === null) {
      nextRules.push(rule);
      setSearch("");
    } else {
      nextRules[editor.index] = rule;
    }
    changeRules(nextRules);
    setEditor(null);
  };

  const duplicateRule = (index: number) => {
    if (data === null) {
      return;
    }
    const nextRules = [...data.rules];
    nextRules.splice(index + 1, 0, cloneRule(data.rules[index]));
    changeRules(nextRules);
  };

  const move = (index: number, offset: number) => {
    if (data === null) {
      return;
    }
    const nextRules = moveRule(data.rules, index, index + offset);
    if (nextRules !== data.rules) {
      changeRules(nextRules);
    }
  };

  const deleteRule = () => {
    if (data === null || deleteIndex === null) {
      return;
    }
    changeRules(data.rules.filter((_, index) => index !== deleteIndex));
    setDeleteIndex(null);
  };

  const finalOptions =
    data === null
      ? []
      : data.outbounds.map((tag) => ({ value: tag, label: tag }));
  if (
    data !== null &&
    data.finalOutbound !== "" &&
    !finalOptions.some((option) => option.value === data.finalOutbound)
  ) {
    finalOptions.unshift({ value: data.finalOutbound, label: data.finalOutbound });
  }

  return (
    <div className="page">
      <PageHeader
        title={t("Routing")}
        actions={
          <>
            <Button
              variant="primary"
              disabled={data === null}
              onClick={() => setEditor({ index: null, rule: null })}
            >
              <Icon name="add" size={13} />
              {t("Add rule")}
            </Button>
            <OthersMenu>
              {data !== null && (
                <MenuItem icon="download" onSelect={download}>
                  {t("Download config")}
                </MenuItem>
              )}
              {data !== null && (
                <MenuItem icon="content_copy" onSelect={copy}>
                  {t("Copy JSON")}
                </MenuItem>
              )}
              {data !== null && host !== null && (
                <MenuItem icon="check" onSelect={() => void check()}>
                  {checking ? t("Loading...") : t("Check configuration")}
                </MenuItem>
              )}
            </OthersMenu>
          </>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.json5,.conf,application/json"
        className={styles.fileInput}
        onChange={(event) => void onFileChange(event)}
      />

      <div className={styles.sourceBar}>
        {host !== null && profiles.profiles.length > 0 ? (
          <>
            <span className={styles.sourceLabel}>{t("Profile")}</span>
            <Select
              inline
              options={profiles.profiles.map((profile) => ({
                value: profile.id,
                label: profile.name.trim() !== "" ? profile.name : profile.id,
              }))}
              value={profileId ?? ""}
              placeholder={t("Select profile")}
              onChange={chooseProfile}
            />
            <IconButton
              title={t("Reload")}
              disabled={profileId === null || loading || dirty}
              onClick={reloadProfile}
            >
              {loading ? <Spinner /> : <Icon name="sync" />}
            </IconButton>
          </>
        ) : (
          <span className={styles.sourceHint}>{t("No profiles")}</span>
        )}

        <Button size="small" onClick={pickFile}>
          <Icon name="upload_file" size={13} />
          {t("Import config")}
        </Button>

        {source?.kind === "file" && (
          <span className={styles.sourceName} title={sourceName}>
            {sourceName}
          </span>
        )}

        {dirty && <Badge tone="medium">{t("Unsaved changes")}</Badge>}

        <span className={styles.sourceSpacer} />

        {data !== null && source?.kind === "profile" && host !== null ? (
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <Spinner /> : <Icon name="save" size={13} />}
            {t("Save to profile")}
          </Button>
        ) : data !== null ? (
          <Button variant="primary" onClick={download}>
            <Icon name="download" size={13} />
            {t("Download config")}
          </Button>
        ) : null}
      </div>

      {host === null && (
        <div className={styles.sourceNote}>
          {t("Direct profile saving is available in the desktop app. Import a configuration file to edit and download it.")}
        </div>
      )}

      {data !== null && source?.kind === "profile" && (
        <div className={styles.sourceNote}>
          {t("Saving rewrites the configuration as formatted JSON.")}
        </div>
      )}

      {error !== null && <div className="banner error">{error}</div>}
      {notice !== null && (
        <div className={styles.notice}>
          <Icon name="check" size={13} />
          {notice}
        </div>
      )}

      {data !== null && (
        <>
          <StatGrid
            items={[
              {
                label: t("Rules"),
                icon: "route",
                tone: "accent",
                value: data.rules.length,
              },
              {
                label: t("Route"),
                icon: "hub",
                tone: "down",
                value: routeCount,
              },
              {
                label: t("Reject"),
                icon: "stop",
                tone: "bad",
                value: rejectCount,
              },
              {
                label: t("Rule sets"),
                icon: "folder",
                tone: "info",
                value: data.ruleSets.length,
              },
            ]}
          />

          {data.outbounds.length > 0 && (
            <Card icon="route" title={t("Final outbound")} className={styles.finalCard}>
              <div className={styles.finalRow}>
                <span className={styles.finalLabel}>{t("Default outbound")}</span>
                <Select
                  inline
                  options={finalOptions}
                  value={data.finalOutbound}
                  placeholder={t("Default outbound")}
                  onChange={changeFinalOutbound}
                />
                <span className="hint">
                  {t("Traffic not matching any rule uses this outbound.")}
                </span>
              </div>
            </Card>
          )}

          <div className={styles.ruleToolbar}>
            <div className={styles.ruleSearch}>
              <SearchInput value={search} onChange={setSearch} />
            </div>
            <span className="hint">
              {t("Showing {shown} of {count}", {
                shown: filteredRules.length,
                count: data.rules.length,
              })}
            </span>
          </div>

          {filteredRules.length === 0 ? (
            <EmptyState icon="route">
              {data.rules.length === 0 ? t("No rules") : t("No matching rules")}
            </EmptyState>
          ) : (
            <div className={styles.ruleList}>
              {filteredRules.map(({ rule, index }) => {
                const action = ruleAction(rule) || "route";
                const outbound = ruleOutbound(rule);
                const ruleSets = ruleRuleSets(rule);
                const entries = ruleMatchEntries(rule);
                const actionLabel = ACTION_LABELS[action];
                return (
                  <div className={styles.ruleCard} key={index}>
                    <span className={styles.ruleOrder}>{index + 1}</span>
                    <div className={styles.ruleMain}>
                      <div className={styles.ruleHead}>
                        <Badge tone={actionTone(action)}>
                          {actionLabel !== undefined ? t(actionLabel) : action}
                        </Badge>
                        {action === "route" && outbound !== "" && (
                          <span className={styles.ruleOutbound}>
                            <Icon name="hub" size={12} />
                            {outbound}
                          </span>
                        )}
                        {action === "reject" && typeof rule.reject_method === "string" && (
                          <span className={styles.ruleOutbound}>
                            {t("Method")}: {rule.reject_method}
                          </span>
                        )}
                        {ruleSets.map((tag) => (
                          <span key={tag} className={styles.ruleSet}>
                            #{tag}
                          </span>
                        ))}
                        {rule.invert === true && (
                          <Badge tone="medium">{t("Invert match")}</Badge>
                        )}
                        <span className={styles.ruleSpacer} />
                        <div className={styles.ruleActions}>
                          <IconButton
                            title={t("Edit")}
                            onClick={() => setEditor({ index, rule })}
                          >
                            <Icon name="edit" size={14} />
                          </IconButton>
                          <IconButton
                            title={t("Duplicate rule")}
                            onClick={() => duplicateRule(index)}
                          >
                            <Icon name="content_copy" size={14} />
                          </IconButton>
                          <IconButton
                            title={t("Move up")}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <Icon name="expand_less" size={14} />
                          </IconButton>
                          <IconButton
                            title={t("Move down")}
                            disabled={index === data.rules.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <Icon name="expand_more" size={14} />
                          </IconButton>
                          <IconButton
                            danger
                            title={t("Delete rule")}
                            onClick={() => setDeleteIndex(index)}
                          >
                            <Icon name="delete" size={14} />
                          </IconButton>
                        </div>
                      </div>
                      {(entries.length > 0 || ruleSets.length === 0) && (
                        <div className={styles.ruleMatches}>
                          {entries.length === 0 ? (
                            <span className="hint">{t("Catch-all")}</span>
                          ) : (
                            entries.map((entry) => (
                              <span
                                className={styles.ruleMatch}
                                key={entry.key}
                                title={`${entry.key}: ${entry.value}`}
                              >
                                <span className={styles.ruleMatchKey}>
                                  {RULE_FIELD_LABELS[entry.key] !== undefined
                                    ? t(RULE_FIELD_LABELS[entry.key])
                                    : entry.key}
                                </span>
                                <span className={styles.ruleMatchValue}>{entry.value}</span>
                              </span>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {data === null && (
        <div className={styles.empty}>
          <EmptyState icon="route">
            {loading ? <Spinner /> : t("No config loaded")}
          </EmptyState>
          {!loading && (
            <>
              <p className="hint">{t("Load a profile or import a configuration file to manage routing rules.")}</p>
              <Button onClick={pickFile}>
                <Icon name="upload_file" size={13} />
                {t("Import config")}
              </Button>
            </>
          )}
        </div>
      )}

      {editor !== null && data !== null && (
        <RouteRuleDialog
          initial={editor.rule}
          outbounds={data.outbounds}
          ruleSets={data.ruleSets}
          onClose={() => setEditor(null)}
          onSave={saveRule}
        />
      )}

      {deleteIndex !== null && data !== null && (
        <Dialog onClose={() => setDeleteIndex(null)}>
          <h3>{t("Delete this rule?")}</h3>
          <p className="dialog-message">{t("This action cannot be undone.")}</p>
          <div className="row-actions dialog-actions">
            <Button onClick={() => setDeleteIndex(null)}>{t("Cancel")}</Button>
            <Button variant="danger" onClick={deleteRule}>
              {t("Delete rule")}
            </Button>
          </div>
        </Dialog>
      )}

      {pendingAction !== null && (
        <Dialog onClose={() => setPendingAction(null)}>
          <h3>{t("Unsaved changes")}</h3>
          <p className="dialog-message">{t("You have unsaved routing changes.")}</p>
          <div className="row-actions dialog-actions">
            <Button onClick={() => setPendingAction(null)}>{t("Cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                action();
              }}
            >
              {t("Discard")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
