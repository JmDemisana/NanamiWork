import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { createDenClient, readDenSettings } from "@/app/lib/den"
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider"
import { useOrgFeatureState } from "@/react-app/domains/cloud/use-org-feature"
import { useAutomationsDenContext } from "@/react-app/domains/automations/use-automations"

const FEATURE_STALE_MS = 30_000

type DesktopFeatureKey = "computerUse" | "computerSessionHistory" | "remoteComputers" | "settledSessions" | "composerBackgroundTasks" | "agentQuestions" | "standardCodeMode" | "steadyLiveTurn" | "plainFreeModel" | "localModelPicker"

/**
 * Reads one desktop feature from the registry. Signed in, it follows the
 * active organization through the shared org-feature hook; signed out, the
 * deployment switch (`GET /v1/features`). Unreachable or missing means off.
 */
const DISABLED_DESKTOP_FEATURES = new Set<DesktopFeatureKey>([
  "computerUse",
  "computerSessionHistory",
  "remoteComputers",
])

export function useDesktopFeature(key: DesktopFeatureKey, active = true): boolean {
  const effectiveActive = active && !DISABLED_DESKTOP_FEATURES.has(key)
  const denAuth = useDenAuth()
  const context = useAutomationsDenContext()
  const baseUrl = readDenSettings().baseUrl
  const deploymentClient = useMemo(() => createDenClient({ baseUrl }), [baseUrl])
  // Not desktopOnly: the web app shows the cloud computer from these flags too.
  const organization = useOrgFeatureState(key, { active: effectiveActive })
  const deployment = useQuery({
    queryKey: ["den", "deployment-features", baseUrl],
    queryFn: () => deploymentClient.getDeploymentFeatures(),
    enabled: effectiveActive && !context.ready && denAuth.status === "signed_out",
    staleTime: FEATURE_STALE_MS,
    refetchInterval: FEATURE_STALE_MS,
    refetchIntervalInBackground: true,
    retry: false,
    select: (features) => features[key] === true,
  })
  return effectiveActive && (context.ready ? organization.enabled : denAuth.status === "signed_out" && !deployment.isError && deployment.data === true)
}
