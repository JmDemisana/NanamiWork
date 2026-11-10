import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { assertConcreteModel, LOCAL_ROUTER_MODEL, LOCAL_ROUTER_TITLE } from "../src/app/lib/local-router-ref";
import { workspaceDefaultModelPayload, WorkspaceDefaultModelSync } from "../src/react-app/kernel/workspace-default-model-sync";
import { computeModelAvailability } from "../src/react-app/domains/session/surface/model-availability";
import { fixedModelTitle, managesOwnBehavior } from "../src/react-app/domains/models/model-catalog";

GlobalRegistrator.register({ url: "http://localhost/" });
window.localStorage.setItem("openwork.sessionModels.v1", JSON.stringify({ ses_fixture: { model: LOCAL_ROUTER_MODEL, variant: null } }));
const { useSessionModelStore } = await import("../src/react-app/domains/session/surface/session-model-store");
afterAll(() => GlobalRegistrator.unregister());

test("the router stays named and remembered as a client-only selection", () => {
  expect(useSessionModelStore.getState().bySessionId.ses_fixture?.model).toEqual(LOCAL_ROUTER_MODEL);
  useSessionModelStore.getState().setModel("ses_other", LOCAL_ROUTER_MODEL, null);
  const saved = JSON.parse(window.localStorage.getItem("openwork.sessionModels.v1") || "{}");
  expect(saved.ses_other.model).toEqual(LOCAL_ROUTER_MODEL);
  expect(fixedModelTitle(LOCAL_ROUTER_MODEL)).toBe(LOCAL_ROUTER_TITLE);
  expect(managesOwnBehavior(LOCAL_ROUTER_MODEL)).toBe(true);
});

test("the client marker cannot become an engine model or server workspace default", () => {
  expect(() => assertConcreteModel(LOCAL_ROUTER_MODEL)).toThrow("must resolve");
  expect(() => assertConcreteModel({ providerID: LOCAL_ROUTER_MODEL.providerID, modelID: "unexpected" })).toThrow("must resolve");
  expect(workspaceDefaultModelPayload(LOCAL_ROUTER_MODEL, null)).toBeNull();
  let scheduled = false;
  const sync = new WorkspaceDefaultModelSync({ scheduleTimer: () => { scheduled = true; return () => {}; } });
  sync.schedule({ serverKey: "local", workspaceKey: "workspace", put: async () => {} }, LOCAL_ROUTER_MODEL);
  expect(scheduled).toBe(false);
});

test("the marker is available only where the local router feature is allowed", () => {
  const context = { workspaceReady: true, loading: false, signedIn: false, cloudProviderSyncReady: true,
    openWorkModelsSyncing: false, restrictToCloud: false, checkRestriction: () => false, cloudProviderList: null, providerList: null };
  expect(computeModelAvailability(LOCAL_ROUTER_MODEL, { ...context, localRouterAvailable: true })).toEqual({ status: "available" });
  expect(computeModelAvailability(LOCAL_ROUTER_MODEL, { ...context, localRouterAvailable: false })).toEqual({ status: "unavailable", reason: "provider_blocked" });
});
