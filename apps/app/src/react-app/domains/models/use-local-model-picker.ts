import { isDesktopRuntime } from "@/app/lib/runtime-env";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import { useDesktopFeature } from "@/react-app/domains/session/status/use-desktop-feature";
import { localModelPickerAvailable } from "./local-model-picker-preference";

/** Standalone desktops enable the picker; managed sessions honor the deployment flag. */
export function useLocalModelPickerEnabled(): boolean {
  const auth = useDenAuth();
  const desktop = isDesktopRuntime();
  const signedOut = auth.status === "signed_out";
  const managedEnabled = useDesktopFeature("localModelPicker", !(desktop && signedOut));
  return localModelPickerAvailable({ desktop, signedOut, managedEnabled });
}
