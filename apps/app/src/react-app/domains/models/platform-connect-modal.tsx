/** @jsxImportSource react */
import * as React from "react";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openDesktopUrl } from "@/app/lib/desktop";
import {
  confirmAntigravityAuthEvent,
  openCodexAuthEvent,
  openWorkbenchInstancesEvent,
} from "@/react-app/shell/new-providers-listener";
import { useAntigravityAccountsStore } from "./antigravity-accounts-store";
import { useCopilotAccountsStore } from "./copilot-accounts-store";
import { useChatGptAccountsStore } from "./chatgpt-accounts-store";

export type PlatformType = "antigravity" | "chatgpt" | "copilot";

export function PlatformConnectModal() {
  const [activePlatform, setActivePlatform] = React.useState<PlatformType>("antigravity");

  // Antigravity Store
  const antigravityOpen = useAntigravityAccountsStore((s) => s.modalOpen);
  const setAntigravityOpen = useAntigravityAccountsStore((s) => s.setModalOpen);
  const antigravityAuthUrl = useAntigravityAccountsStore((s) => s.authUrl);
  const antigravityConnecting = useAntigravityAccountsStore((s) => s.isConnecting);

  // Copilot Store
  const copilotOpen = useCopilotAccountsStore((s) => s.modalOpen);
  const setCopilotOpen = useCopilotAccountsStore((s) => s.setModalOpen);
  const copilotFlow = useCopilotAccountsStore((s) => s.deviceFlow);
  const copilotConnecting = useCopilotAccountsStore((s) => s.isConnecting);
  const copilotError = useCopilotAccountsStore((s) => s.error);
  const startCopilotFlow = useCopilotAccountsStore((s) => s.startDeviceFlow);
  const pollCopilotFlow = useCopilotAccountsStore((s) => s.pollDeviceFlow);
  const cancelCopilotFlow = useCopilotAccountsStore((s) => s.cancelDeviceFlow);
  const loadCopilotAccounts = useCopilotAccountsStore((s) => s.loadAccounts);

  // ChatGPT Store
  const chatGptOpen = useChatGptAccountsStore((s) => s.modalOpen);
  const setChatGptOpen = useChatGptAccountsStore((s) => s.setModalOpen);
  const chatGptAccounts = useChatGptAccountsStore((s) => s.accounts);
  const chatGptAuthUrl = useChatGptAccountsStore((s) => s.authUrl);
  const chatGptConnecting = useChatGptAccountsStore((s) => s.isConnecting);
  const connectChatGptKey = useChatGptAccountsStore((s) => s.connectApiKey);
  const deleteChatGptAccount = useChatGptAccountsStore((s) => s.deleteAccount);
  const chatGptError = useChatGptAccountsStore((s) => s.error);

  const [copiedCode, setCopiedCode] = React.useState(false);
  const [apiKeyInput, setApiKeyInput] = React.useState("");

  const isOpen = antigravityOpen || copilotOpen || chatGptOpen;

  // Sync active platform strictly based on which button was clicked
  React.useEffect(() => {
    if (copilotOpen) setActivePlatform("copilot");
    else if (chatGptOpen) setActivePlatform("chatgpt");
    else if (antigravityOpen) setActivePlatform("antigravity");
  }, [copilotOpen, chatGptOpen, antigravityOpen]);

  // When opening Copilot, initiate device flow automatically
  React.useEffect(() => {
    if (isOpen && activePlatform === "copilot" && !copilotFlow && !copilotConnecting) {
      void (async () => {
        const flow = await startCopilotFlow();
        if (flow) {
          void pollCopilotFlow();
        }
      })();
    }
  }, [isOpen, activePlatform, copilotFlow, copilotConnecting, startCopilotFlow, pollCopilotFlow]);

  const handleClose = () => {
    cancelCopilotFlow();
    setAntigravityOpen(false);
    setCopilotOpen(false);
    setChatGptOpen(false);
    setApiKeyInput("");
  };

  const handleCopyCopilotCode = async () => {
    if (!copilotFlow?.userCode) return;
    try {
      await navigator.clipboard.writeText(copilotFlow.userCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (e) {
      console.warn("Could not copy code:", e);
    }
  };

  const handleOpenGoogle = () => {
    if (antigravityAuthUrl) {
      void openDesktopUrl(antigravityAuthUrl);
    } else {
      window.dispatchEvent(new Event(openWorkbenchInstancesEvent));
    }
  };

  const handleOpenCopilot = () => {
    if (!copilotFlow?.verificationUri) return;
    void openDesktopUrl(copilotFlow.verificationUri);
  };

  const handleOpenChatGpt = () => {
    void openDesktopUrl("https://chatgpt.com");
  };

  const handleOpenOpenAiKeys = () => {
    void openDesktopUrl("https://platform.openai.com/api-keys");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="w-[32rem] sm:max-w-[32rem] p-0 overflow-hidden rounded-2xl border-border bg-card shadow-2xl">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            {activePlatform === "antigravity" ? (
              <>
                <Sparkles className="size-4 text-amber-500" />
                <span>Connect Google Antigravity</span>
              </>
            ) : activePlatform === "copilot" ? (
              <>
                <Sparkles className="size-4 text-emerald-500" />
                <span>Connect GitHub Copilot</span>
              </>
            ) : (
              <>
                <Bot className="size-4 text-sky-500" />
                <span>Connect OpenAI / ChatGPT</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            {activePlatform === "antigravity"
              ? "Sign in with Google to enable multi-account load balancing and live quota limits."
              : activePlatform === "copilot"
              ? "Link your GitHub account using device authorization for Copilot models."
              : "Connect your ChatGPT consumer account session or paste an API key."}
          </DialogDescription>
        </DialogHeader>

        <div className="p-5">
          {/* Antigravity */}
          {activePlatform === "antigravity" && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background shadow-xs">
                  <Sparkles className="size-4 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">Google Antigravity</div>
                  <div className="text-[11px] text-muted-foreground">Local OAuth 2.0 Loopback (:51121)</div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Sign in with your Google account in your default browser. Nanami will capture the session automatically.
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full justify-between h-9 text-xs font-medium border-border/80 hover:bg-muted/50"
                onClick={handleOpenGoogle}
              >
                <span>Open Sign-In in Browser</span>
                <ExternalLink className="size-3.5 text-muted-foreground" />
              </Button>

              <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-amber-500 shrink-0" />
                <span>
                  {antigravityConnecting
                    ? "Waiting for authorization on localhost:51121..."
                    : "Checking connection status automatically…"}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground/80 leading-snug">
                For accounts using Antigravity for the first time, authenticate once with the official app if verification is required.
              </p>
            </div>
          )}

          {/* Copilot */}
          {activePlatform === "copilot" && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background shadow-xs">
                  <Sparkles className="size-4 text-emerald-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">GitHub Copilot</div>
                  <div className="text-[11px] text-muted-foreground">Student & Individual Device Authorization</div>
                </div>
              </div>

              {copilotError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center justify-between gap-2">
                  <span className="truncate">{copilotError}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] shrink-0 hover:bg-destructive/20 text-destructive"
                    onClick={() => {
                      void (async () => {
                        const flow = await startCopilotFlow();
                        if (flow) void pollCopilotFlow();
                      })();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Authorize your GitHub account using the device activation code below.
              </div>

              {copilotFlow ? (
                <>
                  <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-3.5 py-2.5">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Activation Code</div>
                      <div className="text-base font-mono font-bold tracking-widest text-foreground">{copilotFlow.userCode}</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={handleCopyCopilotCode}
                    >
                      {copiedCode ? (
                        <>
                          <Check className="size-3.5 text-emerald-500" />
                          <span className="text-emerald-500">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>Copy Code</span>
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between h-9 text-xs font-medium border-border/80 hover:bg-muted/50"
                      onClick={handleOpenCopilot}
                    >
                      <span>Open GitHub Activation Page</span>
                      <ExternalLink className="size-3.5 text-muted-foreground" />
                    </Button>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                        onClick={handleOpenCopilot}
                      >
                        Open github.com/login/device →
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-emerald-500 shrink-0" />
                    <span>
                      {copilotConnecting
                        ? "Waiting for device authorization on GitHub…"
                        : "Device code ready. Authorize in your browser…"}
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full h-9 text-xs font-medium gap-2 border border-border/70"
                    onClick={async () => {
                      await loadCopilotAccounts();
                      setCopilotOpen(false);
                    }}
                  >
                    <RefreshCw className="size-3.5" />
                    <span>Click to Confirm & Refresh</span>
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-5 animate-spin text-emerald-500" />
                  <span>Requesting device code from GitHub...</span>
                </div>
              )}
            </div>
          )}

          {/* ChatGPT */}
          {activePlatform === "chatgpt" && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background shadow-xs">
                  <Bot className="size-4 text-sky-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">OpenAI / ChatGPT</div>
                  <div className="text-[11px] text-muted-foreground">Consumer Session & Multi-Account Pool</div>
                </div>
              </div>

              {chatGptError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {chatGptError}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Sign in with your ChatGPT account in your browser. The account appears after authorization.
              </div>

              {/* Step 1: Open Browser Sign-In */}
              <div className="space-y-1.5">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between h-9 text-xs font-medium border-border/80 hover:bg-muted/50"
                  disabled={chatGptConnecting && !chatGptAuthUrl}
                  onClick={() => {
                    if (chatGptAuthUrl) {
                      void openDesktopUrl(chatGptAuthUrl);
                    } else {
                      // Use OpenCode's OAuth callback listener. It already
                      // owns localhost:1455 and persists the returned token.
                      window.dispatchEvent(new Event(openCodexAuthEvent));
                    }
                  }}
                >
                  <span>Open ChatGPT Sign-In</span>
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                </Button>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                    onClick={handleOpenChatGpt}
                  >
                    Open chatgpt.com →
                  </button>
                </div>
              </div>

              {/* Step 2: Live status */}
              <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-sky-500 shrink-0" />
                <span>
                  {chatGptConnecting
                    ? "Waiting for ChatGPT authorization and account capture…"
                    : "Ready to authenticate via browser…"}
                </span>
              </div>


            </div>
          )}
        </div>

        {/* Standard Modal Footer */}
        <div className="border-t border-border px-5 py-3 flex items-center justify-between bg-muted/10">
          <span className="text-[11px] text-muted-foreground">
            This window will close once connected.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleClose}>
              Close
            </Button>
            {activePlatform !== "chatgpt" ? <Button
              variant="secondary"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={async () => {
                if (activePlatform === "antigravity") {
                  window.dispatchEvent(new Event(confirmAntigravityAuthEvent));
                } else {
                  await loadCopilotAccounts();
                  setCopilotOpen(false);
                }
              }}
              title="Confirm & Refresh"
            >
              <RefreshCw className="size-3" />
              <span>Refresh</span>
            </Button> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
