/** @jsxImportSource react */
import * as React from "react";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openDesktopUrl } from "@/app/lib/desktop";
import { openWorkbenchInstancesEvent } from "@/react-app/shell/new-providers-listener";
import { useAntigravityAccountsStore } from "./antigravity-accounts-store";

export function AntigravityAuthModal() {
  const modalOpen = useAntigravityAccountsStore((s) => s.modalOpen);
  const setModalOpen = useAntigravityAccountsStore((s) => s.setModalOpen);
  const authUrl = useAntigravityAccountsStore((s) => s.authUrl);
  const isConnecting = useAntigravityAccountsStore((s) => s.isConnecting);
  const error = useAntigravityAccountsStore((s) => s.error);

  const handleOpenGoogle = () => {
    if (authUrl) {
      void openDesktopUrl(authUrl);
    } else {
      window.dispatchEvent(new Event(openWorkbenchInstancesEvent));
    }
  };

  return (
    <Dialog
      open={modalOpen}
      onOpenChange={(open) => {
        if (!open) {
          setModalOpen(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-amber-500" />
            Connect Google Antigravity
          </DialogTitle>
          <DialogDescription className="text-xs">
            Link your Google developer account to access Gemini, Claude, and GPT models with live quota tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-xs text-muted-foreground">
              1. Sign in with your Google account in your default browser:
            </span>

            <Button
              type="button"
              className="w-full gap-2"
              onClick={handleOpenGoogle}
            >
              <span>Open Google Sign-In</span>
              <ExternalLink className="size-3.5" />
            </Button>

            <span className="text-xs text-muted-foreground">
              2. Allow permissions and return to NanamiWork:
            </span>

            <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-amber-500" />
              <span>
                {isConnecting
                  ? "Waiting for browser authorization on localhost:51121..."
                  : "Ready to authenticate..."}
              </span>
            </div>

            <div className="mt-2 rounded-lg border bg-muted/30 p-2.5 text-center text-[11px] text-muted-foreground leading-snug">
              💡 For accounts using Antigravity for the first time, authenticate once with the official app if verification is required.
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setModalOpen(false)}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
