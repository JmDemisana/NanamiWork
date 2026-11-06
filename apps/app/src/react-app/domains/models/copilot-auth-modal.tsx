/** @jsxImportSource react */
import * as React from "react";
import { Copy, ExternalLink, Loader2, Sparkles, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openDesktopUrl } from "@/app/lib/desktop";
import { useCopilotAccountsStore } from "./copilot-accounts-store";

export function CopilotAuthModal() {
  const modalOpen = useCopilotAccountsStore((s) => s.modalOpen);
  const setModalOpen = useCopilotAccountsStore((s) => s.setModalOpen);
  const deviceFlow = useCopilotAccountsStore((s) => s.deviceFlow);
  const isConnecting = useCopilotAccountsStore((s) => s.isConnecting);
  const error = useCopilotAccountsStore((s) => s.error);
  const startDeviceFlow = useCopilotAccountsStore((s) => s.startDeviceFlow);
  const pollDeviceFlow = useCopilotAccountsStore((s) => s.pollDeviceFlow);
  const cancelDeviceFlow = useCopilotAccountsStore((s) => s.cancelDeviceFlow);

  const [copied, setCopied] = React.useState(false);

  // When modal opens, start device flow if not already active
  React.useEffect(() => {
    if (modalOpen && !deviceFlow && !isConnecting) {
      void (async () => {
        const flow = await startDeviceFlow();
        if (flow) {
          void pollDeviceFlow();
        }
      })();
    }
  }, [modalOpen, deviceFlow, isConnecting, startDeviceFlow, pollDeviceFlow]);

  const handleCopyCode = async () => {
    if (!deviceFlow?.userCode) return;
    try {
      await navigator.clipboard.writeText(deviceFlow.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Could not copy user code:", e);
    }
  };

  const handleOpenGitHub = () => {
    if (!deviceFlow?.verificationUri) return;
    void openDesktopUrl(deviceFlow.verificationUri);
  };

  return (
    <Dialog
      open={modalOpen}
      onOpenChange={(open) => {
        if (!open) {
          cancelDeviceFlow();
          setModalOpen(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-emerald-500" />
            Connect GitHub Copilot (Fusion)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Authenticate your GitHub account (Student, Individual, or Business) to access Copilot models.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {deviceFlow ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="text-xs text-muted-foreground">
                1. Copy your one-time GitHub device activation code:
              </span>

              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2">
                <span className="font-mono text-xl font-bold tracking-wider text-foreground">
                  {deviceFlow.userCode}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={handleCopyCode}
                  title="Copy code"
                >
                  {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                </Button>
              </div>

              <span className="text-xs text-muted-foreground">
                2. Enter the code in the GitHub authorization page:
              </span>

              <Button
                type="button"
                className="w-full gap-2"
                onClick={handleOpenGitHub}
              >
                <span>Open GitHub Activation Page</span>
                <ExternalLink className="size-3.5" />
              </Button>

              <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-emerald-500" />
                <span>Waiting for your authorization on GitHub...</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span>Requesting device code from GitHub...</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              cancelDeviceFlow();
              setModalOpen(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
