import { isDesktopRuntime } from "@/app/lib/runtime-env";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import { useDesktopFeature } from "@/react-app/domains/session/status/use-desktop-feature";
import { localModelPickerAvailable, useLocalModelPickerPreference } from "./local-model-picker-preference";

/** Standalone desktops use the local switch; managed sessions honor the deployment flag. */
export function useLocalModelPickerEnabled(): boolean {
  const auth = useDenAuth();
  const desktop = isDesktopRuntime();
  const signedOut = auth.status === "signed_out";
  const managedEnabled = useDesktopFeature("localModelPicker", !(desktop && signedOut));
  const localEnabled = useLocalModelPickerPreference((state) => state.enabled);
  return localModelPickerAvailable({ desktop, signedOut, localEnabled, managedEnabled });
}
