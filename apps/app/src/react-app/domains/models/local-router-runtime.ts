import { createOpenworkServerClient, isLoopbackOpenworkServerUrl, readOpenworkServerSettings, type OpenworkServerClient } from "@/app/lib/openwork-server";
import { isDesktopRuntime } from "@/app/lib/runtime-env";
import { isOpencodeV2BaseUrl } from "@/app/lib/opencode-v2-adapter";
import { createClient } from "@/app/lib/opencode";
import type { Client, ModelOption, ModelRef } from "@/app/types";
import { readManagedDisabledProviders } from "@/react-app/domains/connections/managed-engine-config";
import { useModelPickerCatalogStore } from "@/react-app/domains/session/models/model-collections-store";
import { activateAntigravityRouterAccount, restoreAntigravityRouterPin, useAntigravityAccountsStore } from "./antigravity-accounts-store";
import { activateChatGptRouterAccount, useChatGptAccountsStore } from "./chatgpt-accounts-store";
import { activateCopilotRouterAccount, useCopilotAccountsStore } from "./copilot-accounts-store";
import { dispatchLocalRouterTurn, type ResolvedTurnModel } from "./local-router-dispatch";
import { buildLocalRouterAccounts, getLastLocalRouterCandidate, recordLocalRouterUse, useLocalRouterStore } from "./nanami-local-router";
import {
  ORCHESTRATOR_EXECUTE_SYSTEM_PROMPT,
  ORCHESTRATOR_PLAN_SYSTEM_PROMPT,
  getAntigravityOrchestratorModels,
  getChatGptOrchestratorModels,
  isAntigravityOrchestratorSupported,
  isChatGptOrchestratorSupported,
  isOrchestratorModel,
  useOrchestratorStore,
} from "./orchestrator-store";

/** Never send the desktop host token to a different loopback service. */
export function isConfiguredRouterHost(baseUrl: string, settings: { urlOverride?: string; portOverride?: number }): boolean {
  const configured = settings.urlOverride || (settings.portOverride ? `http://127.0.0.1:${settings.portOverride}` : "");
  if (!configured || !isLoopbackOpenworkServerUrl(configured) || !isLoopbackOpenworkServerUrl(baseUrl)) return false;
  try {
    const expected = new URL(configured);
    const actual = new URL(baseUrl);
    return expected.protocol === actual.protocol && expected.port === actual.port
      && expected.hostname.toLowerCase() === actual.hostname.toLowerCase()
      && !expected.username && !expected.password && !actual.username && !actual.password
      && expected.pathname.replace(/\/+$/, "") === actual.pathname.replace(/\/+$/, "")
      && !expected.search && !actual.search && !expected.hash && !actual.hash;
  } catch {
    return false;
  }
}

export async function dispatchConfiguredLocalRouterTurn<T>(input: {
  selected: ModelRef | null;
  variant: string | null;
  steer?: boolean;
  sessionId: string;
  opencodeClient: Client;
  opencodeBaseUrl: string;
  openworkClient: OpenworkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  options: readonly ModelOption[];
  localWorkspace: boolean;
  restrictToCloud: boolean;
  enabled: boolean;
  send: (selection: ResolvedTurnModel & { client: Client }) => Promise<T>;
  assertCurrent?: () => void;
}): Promise<T> {
  const settings = readOpenworkServerSettings();
  const localRuntime = input.enabled && input.localWorkspace && isDesktopRuntime() && isConfiguredRouterHost(input.openworkClient.baseUrl, settings) && !input.restrictToCloud;
  let leasedClient: Client | null = null;
  let leaseId: string | null = null;
  const host = settings.hostToken && localRuntime
    ? createOpenworkServerClient({ baseUrl: input.openworkClient.baseUrl, token: input.openworkClient.token, hostToken: settings.hostToken })
    : null;
  const releaseRouterLease = async () => {
    const currentLeaseId = leaseId;
    leaseId = null;
    leasedClient = null;
    if (currentLeaseId && host) await host.releaseLocalRouterLease(currentLeaseId).catch(() => undefined);
  };
  try {
  if (isOrchestratorModel(input.selected)) {
    const providerID = input.selected!.providerID as "google" | "openai";
    let accountEmail = "";
    let planningModelId = "";
    let executionModelId = "";
    if (providerID === "google") {
      let ag = useAntigravityAccountsStore.getState();
      if (ag.lastLoadedAt === null) {
        await ag.loadAccounts(input.opencodeClient);
        ag = useAntigravityAccountsStore.getState();
      }
      const active = ag.accounts.find((a) => a.isActive) ?? ag.accounts[0];
      if (!active || !isAntigravityOrchestratorSupported(active)) {
        throw new Error("Orchestrator requires a supported Antigravity Plus or Pro account.");
      }
      const models = getAntigravityOrchestratorModels(active, ag.thinkingTier);
      const pair = useOrchestratorStore.getState().getAccountConfig("google", active.email, models);
      if (!pair) throw new Error("No models available for Orchestrator on this account.");
      accountEmail = active.email;
      planningModelId = pair.planningModelId;
      executionModelId = pair.executionModelId;
    } else {
      let cg = useChatGptAccountsStore.getState();
      if (!cg.hasLoadedAccounts) {
        await cg.loadAccounts(input.opencodeClient);
        cg = useChatGptAccountsStore.getState();
      }
      const active = cg.accounts.find((a) => a.isActive) ?? cg.accounts[0];
      if (!active || !isChatGptOrchestratorSupported(active)) {
        throw new Error("Orchestrator requires a supported ChatGPT Plus or Pro account.");
      }
      const models = getChatGptOrchestratorModels(active);
      const pair = useOrchestratorStore.getState().getAccountConfig("openai", active.email, models);
      if (!pair) throw new Error("No models available for Orchestrator on this account.");
      accountEmail = active.email;
      planningModelId = pair.planningModelId;
      executionModelId = pair.executionModelId;
    }

    const existingTurn = input.steer ? useOrchestratorStore.getState().getSessionTurn(input.sessionId) : undefined;
    const isExecutingSteer = Boolean(input.steer && existingTurn?.phase === "executing");
    if (!input.steer) {
      useOrchestratorStore.getState().setSessionTurn(input.sessionId, {
        phase: "planning",
        providerID,
        accountEmail,
        planningModelId,
        executionModelId,
        variant: input.variant,
        systemPromptBase: "",
      });
    }
    const targetModelId = isExecutingSteer ? (existingTurn?.executionModelId ?? executionModelId) : planningModelId;
    return await dispatchLocalRouterTurn({
      selected: { providerID, modelID: targetModelId },
      variant: input.variant,
      steer: input.steer,
      localRuntime,
      assertCurrent: input.assertCurrent,
      settings: () => useLocalRouterStore.getState(),
      steeringCandidate: () => getLastLocalRouterCandidate(input.sessionId),
      accounts: async () => [],
      release: releaseRouterLease,
      ensureIdle: async () => undefined,
      activate: async () => undefined,
      record: () => undefined,
      send: (selection) =>
        input.send({
          ...selection,
          client: input.opencodeClient,
          tools: isExecutingSteer
            ? { exit_plan_mode: false }
            : { edit: false, write: false, patch: false, multiedit: false, apply_patch: false, exit_plan_mode: true },
          systemAppend: isExecutingSteer ? ORCHESTRATOR_EXECUTE_SYSTEM_PROMPT : ORCHESTRATOR_PLAN_SYSTEM_PROMPT,
        }),
    });
  }
  useOrchestratorStore.getState().setSessionTurn(input.sessionId, null);
  return await dispatchLocalRouterTurn({
    selected: input.selected,
    variant: input.variant,
    steer: input.steer,
    localRuntime,
    assertCurrent: input.assertCurrent,
    settings: () => useLocalRouterStore.getState(),
    steeringCandidate: () => getLastLocalRouterCandidate(input.sessionId),
    accounts: async () => {
      const antigravity = useAntigravityAccountsStore.getState();
      const chatgpt = useChatGptAccountsStore.getState();
      const copilot = useCopilotAccountsStore.getState();
      if (antigravity.lastLoadedAt === null || !chatgpt.hasLoadedAccounts || !copilot.hasLoadedAccounts) {
        // Discovery and background quota reads do not change engine auth.
        await Promise.all([
          antigravity.lastLoadedAt === null ? antigravity.loadAccounts(input.opencodeClient) : Promise.resolve(),
          !chatgpt.hasLoadedAccounts ? chatgpt.loadAccounts(input.opencodeClient) : Promise.resolve(),
          !copilot.hasLoadedAccounts ? copilot.loadAccounts(input.opencodeClient) : Promise.resolve(),
        ]);
        if (useAntigravityAccountsStore.getState().lastLoadedAt === null
          || !useChatGptAccountsStore.getState().hasLoadedAccounts
          || !useCopilotAccountsStore.getState().hasLoadedAccounts) {
          throw new Error("Local Router could not load connected accounts. Open the model picker and retry.");
        }
      }
      input.assertCurrent?.();
      const disabledProviders = await readManagedDisabledProviders({
        opencodeClient: input.opencodeClient,
        openworkClient: input.openworkClient,
        workspaceId: input.workspaceId,
        workspaceType: "local",
        directory: input.workspaceRoot || undefined,
        requireRuntime: true,
      });
      const latestAntigravity = useAntigravityAccountsStore.getState();
      const options = useModelPickerCatalogStore.getState().bySession[input.sessionId]?.options ?? input.options;
      return buildLocalRouterAccounts({
        antigravity: latestAntigravity.accounts,
        chatgpt: useChatGptAccountsStore.getState().accounts,
        copilot: useCopilotAccountsStore.getState().accounts,
        thinkingTier: "medium",
        options,
        disabledProviders,
        restrictToCloud: input.restrictToCloud,
      });
    },
    release: releaseRouterLease,
    ensureIdle: async (candidate) => {
      if (isOpencodeV2BaseUrl(input.opencodeBaseUrl)) {
        throw new Error("Local Router account switching is not available on this engine yet. Nothing was sent.");
      }
      if (!host || !settings.hostToken) throw new Error("Local Router cannot verify this computer's engine activity. Nothing was sent.");
      await releaseRouterLease();
      const lease = await host.acquireLocalRouterLease({ workspaceId: input.workspaceId, sessionId: input.sessionId,
        providerId: candidate.ref.providerID, modelId: candidate.ref.modelID });
      if (!/^[a-f0-9]{64}$/.test(lease.id)) throw new Error("Local Router could not secure the engine. Nothing was sent.");
      leaseId = lease.id;
      leasedClient = createClient(input.opencodeBaseUrl, input.workspaceRoot || undefined,
        { token: input.openworkClient.token, mode: "openwork" },
        { desktopTransport: "main", localRouterLease: { id: lease.id, hostToken: settings.hostToken } });
    },
    activate: async (candidate) => {
      if (candidate.account.kind !== "antigravity") await restoreAntigravityRouterPin();
      if (candidate.account.kind === "local") return;
      if (!leasedClient) throw new Error("Local Router could not secure the engine. Nothing was sent.");
      if (candidate.account.kind === "antigravity") await activateAntigravityRouterAccount(candidate.account.accountID, candidate.model.modelID, leasedClient);
      else if (candidate.account.kind === "chatgpt") await activateChatGptRouterAccount(candidate.account.accountID, candidate.model.modelID, leasedClient);
      else if (candidate.account.kind === "copilot") await activateCopilotRouterAccount(candidate.account.accountID, candidate.model.modelID, leasedClient);
    },
    record: (candidate) => recordLocalRouterUse(candidate, input.sessionId),
    send: (selection) => input.send({ ...selection, tools: { exit_plan_mode: false }, client: leasedClient ?? input.opencodeClient }),
  });
  } finally {
    await releaseRouterLease();
  }
}
