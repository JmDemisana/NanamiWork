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
import { openWorkbenchInstancesEvent } from "@/react-app/shell/new-providers-listener";
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
  const antigravityAccounts = useAntigravityAccountsStore((s) => s.accounts);

  // Copilot Store
  const copilotOpen = useCopilotAccountsStore((s) => s.modalOpen);
  const setCopilotOpen = useCopilotAccountsStore((s) => s.setModalOpen);
  const copilotFlow = useCopilotAccountsStore((s) => s.deviceFlow);
  const copilotConnecting = useCopilotAccountsStore((s) => s.isConnecting);
  const copilotAccount = useCopilotAccountsStore((s) => s.account);
  const startCopilotFlow = useCopilotAccountsStore((s) => s.startDeviceFlow);
  const pollCopilotFlow = useCopilotAccountsStore((s) => s.pollDeviceFlow);
  const cancelCopilotFlow = useCopilotAccountsStore((s) => s.cancelDeviceFlow);

  // ChatGPT Store
  const chatGptOpen = useChatGptAccountsStore((s) => s.modalOpen);
  const setChatGptOpen = useChatGptAccountsStore((s) => s.setModalOpen);
  const chatGptAccount = useChatGptAccountsStore((s) => s.account);
  const chatGptConnecting = useChatGptAccountsStore((s) => s.isConnecting);
  const connectChatGptKey = useChatGptAccountsStore((s) => s.connectApiKey);
  const chatGptError = useChatGptAccountsStore((s) => s.error);

  const [copiedCode, setCopiedCode] = React.useState(false);
  const [apiKeyInput, setApiKeyInput] = React.useState("");

  const isOpen = antigravityOpen || copilotOpen || chatGptOpen;

  // Sync tab when opened from a specific button
  React.useEffect(() => {
    if (copilotOpen) setActivePlatform("copilot");
    else if (chatGptOpen) setActivePlatform("chatgpt");
    else if (antigravityOpen) setActivePlatform("antigravity");
  }, [copilotOpen, chatGptOpen, antigravityOpen]);

  // When switching to Copilot, initiate device flow if needed
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

  const handleConfirmAndRefresh = () => {
    window.location.reload();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-emerald-500" />
            Connect a Platform
          </DialogTitle>
          <DialogDescription className="text-xs">
            Link your developer accounts to enable multi-account load balancing, intelligent routing, and live limits.
          </DialogDescription>
        </DialogHeader>

        {/* Platform Selector Tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1 text-xs">
          <button
            type="button"
            onClick={() => setActivePlatform("antigravity")}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium transition-all ${
              activePlatform === "antigravity"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="size-3.5 text-amber-500" />
            <span className="truncate">Antigravity</span>
            {antigravityAccounts.length > 0 && (
              <span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActivePlatform("copilot")}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium transition-all ${
              activePlatform === "copilot"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="size-3.5 text-emerald-500" />
            <span className="truncate">Copilot</span>
            {copilotAccount && (
              <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActivePlatform("chatgpt")}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium transition-all ${
              activePlatform === "chatgpt"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Bot className="size-3.5 text-sky-500" />
            <span className="truncate">ChatGPT</span>
            {chatGptAccount && (
              <span className="size-1.5 rounded-full bg-sky-500 shrink-0" />
            )}
          </button>
        </div>

        {/* Tab 1: Antigravity */}
        {activePlatform === "antigravity" && (
          <div className="flex flex-col gap-3 py-1">
            <span className="text-xs text-muted-foreground">
              1. Sign in with your Google account in your browser:
            </span>

            <Button
              type="button"
              className="w-full gap-2 text-xs"
              onClick={handleOpenGoogle}
            >
              <span>Open Google Sign-In</span>
              <ExternalLink className="size-3.5" />
            </Button>

            <span className="text-xs text-muted-foreground">
              2. Complete authorization and return to NanamiWork:
            </span>

            <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-amber-500" />
              <span>
                {antigravityConnecting
                  ? "Waiting for browser authorization on localhost:51121..."
                  : "Ready to authenticate..."}
              </span>
            </div>

            <div className="rounded-lg border bg-muted/30 p-2 text-center text-[11px] text-muted-foreground leading-snug">
              💡 For accounts using Antigravity for the first time, authenticate once with the official app if verification is required.
            </div>

            {/* Common Confirm & Refresh Step */}
            <div className="mt-2 flex flex-col gap-1.5 pt-2 border-t border-border/50">
              <span className="text-[11px] text-muted-foreground text-center">
                3. Finished logging in? Refresh to load your models:
              </span>
              <Button
                type="button"
                className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-white font-medium"
                size="sm"
                onClick={handleConfirmAndRefresh}
              >
                <RefreshCw className="size-3.5" />
                <span>Click to Confirm & Refresh</span>
              </Button>
            </div>
          </div>
        )}

        {/* Tab 2: Copilot */}
        {activePlatform === "copilot" && (
          <div className="flex flex-col gap-3 py-1">
            {copilotFlow ? (
              <>
                <span className="text-xs text-muted-foreground">
                  1. Copy your one-time GitHub device activation code:
                </span>

                <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-2">
                  <span className="font-mono text-xl font-bold tracking-wider text-foreground">
                    {copilotFlow.userCode}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={handleCopyCopilotCode}
                    title="Copy code"
                  >
                    {copiedCode ? (
                      <Check className="size-4 text-emerald-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>

                <span className="text-xs text-muted-foreground">
                  2. Enter the code in the GitHub authorization page:
                </span>

                <Button
                  type="button"
                  className="w-full gap-2 text-xs"
                  onClick={handleOpenCopilot}
                >
                  <span>Open GitHub Activation Page</span>
                  <ExternalLink className="size-3.5" />
                </Button>

                <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin text-emerald-500" />
                  <span>Waiting for your authorization on GitHub...</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span>Requesting device code from GitHub...</span>
              </div>
            )}

            {/* Common Confirm & Refresh Step */}
            <div className="mt-2 flex flex-col gap-1.5 pt-2 border-t border-border/50">
              <span className="text-[11px] text-muted-foreground text-center">
                3. Finished authorizing? Refresh to load Copilot models:
              </span>
              <Button
                type="button"
                className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                size="sm"
                onClick={handleConfirmAndRefresh}
              >
                <RefreshCw className="size-3.5" />
                <span>Click to Confirm & Refresh</span>
              </Button>
            </div>
          </div>
        )}

        {/* Tab 3: ChatGPT */}
        {activePlatform === "chatgpt" && (
          <div className="flex flex-col gap-3 py-1">
            {chatGptError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {chatGptError}
              </div>
            )}

            {chatGptAccount?.accessToken ? (
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    Connected ChatGPT Account
                  </span>
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-400">
                    {chatGptAccount.planType || "Active"}
                  </span>
                </div>
                <span className="font-mono text-muted-foreground">
                  {chatGptAccount.email || "Active OAuth Session"}
                </span>
              </div>
            ) : null}

            <span className="text-xs text-muted-foreground">
              1. Sign in to your ChatGPT consumer account in your browser:
            </span>

            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 text-xs"
              onClick={handleOpenChatGpt}
            >
              <span>Open ChatGPT in Browser</span>
              <ExternalLink className="size-3.5" />
            </Button>

            <span className="text-xs text-muted-foreground">
              Or connect directly via OpenAI API Key:
            </span>

            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Key className="absolute left-3 top-2.5 size-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="password"
                  placeholder="sk-..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  disabled={chatGptConnecting}
                  className="w-full rounded-md border bg-muted/40 py-1.5 pl-8 pr-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 text-xs"
                disabled={chatGptConnecting || !apiKeyInput.trim()}
                onClick={() => void connectChatGptKey(apiKeyInput)}
              >
                {chatGptConnecting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  "Save Key"
                )}
              </Button>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 justify-start text-[11px] text-muted-foreground hover:text-foreground p-0"
              onClick={handleOpenOpenAiKeys}
            >
              Get an OpenAI API Key →
            </Button>

            {/* Common Confirm & Refresh Step */}
            <div className="mt-2 flex flex-col gap-1.5 pt-2 border-t border-border/50">
              <span className="text-[11px] text-muted-foreground text-center">
                2. Finished logging in or adding key? Refresh to load models:
              </span>
              <Button
                type="button"
                className="w-full gap-2 bg-sky-500 hover:bg-sky-600 text-white font-medium"
                size="sm"
                onClick={handleConfirmAndRefresh}
              >
                <RefreshCw className="size-3.5" />
                <span>Click to Confirm & Refresh</span>
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
