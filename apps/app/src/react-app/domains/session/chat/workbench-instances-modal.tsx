/** @jsxImportSource react */
import { useState } from "react";
import { Bot, Check, ExternalLink, KeyRound, Laptop, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type InstanceCard = {
  id: string;
  title: string;
  model: string;
  detail: string;
  providerId?: string;
  icon: typeof Bot;
};

const INSTANCES: readonly InstanceCard[] = [
  {
    id: "antigravity-personal",
    title: "Google Antigravity (Personal Account)",
    model: "Gemini 3.8 Flash Medium",
    detail: "Uses your locally running Antigravity Language Server or CLI bridge. The bridge address and authentication stay on this computer.",
    icon: Laptop,
  },
  {
    id: "google",
    title: "Google AI Studio API (Free API)",
    model: "Gemini 3.6 Flash Medium",
    detail: "Connect a personal Google AI Studio API key. The provider lists the model IDs currently available to that key.",
    providerId: "google",
    icon: KeyRound,
  },
  {
    id: "github-copilot",
    title: "GitHub Copilot",
    model: "Copilot models",
    detail: "Authenticate with your GitHub browser flow or token. Availability depends on your free, student, or paid Copilot entitlement.",
    providerId: "github-copilot",
    icon: Bot,
  },
  {
    id: "opencode",
    title: "OpenCode Zen",
    model: "Zen models",
    detail: "Connect an OpenCode Zen key using the supported local authentication route.",
    providerId: "opencode",
    icon: Sparkles,
  },
  {
    id: "nanami",
    title: "OpenWorks Free",
    model: "Nanami Gateway",
    detail: "The local default route for new sessions. It is available without an OpenWork Cloud account.",
    icon: Check,
  },
];

export function WorkbenchInstancesModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectedProviderIds: readonly string[];
  onOpenProviderAuth: (providerId?: string) => void;
}) {
  const [bridgeExpanded, setBridgeExpanded] = useState(false);
  const connected = new Set(props.connectedProviderIds.map((id) => id.toLowerCase()));
  const isConfigured = (instance: InstanceCard) => instance.id === "nanami"
    || connected.has(instance.id)
    || (instance.id === "github-copilot" && connected.has("github"));

  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent className="w-[min(calc(100vw-2rem),44rem)] max-w-[44rem]">
      <DialogHeader>
        <DialogTitle>Nanami Workbench Instances</DialogTitle>
        <DialogDescription>Choose the local route you want to configure. Other providers stay tucked away unless you need them.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        {INSTANCES.map((instance, index) => {
          const Icon = instance.icon;
          const isDefault = instance.id === "nanami";
          const isConnected = isConfigured(instance);
          return <section key={instance.id} className="rounded-xl border border-dls-border bg-dls-hover/40 p-4">
            <div className="flex gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-dls-surface text-dls-accent"><Icon size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-dls-text">{index + 1}. {instance.title}</h3>
                  <span className={isConnected ? "rounded-full bg-emerald-9/15 px-2 py-0.5 text-[11px] font-medium text-emerald-11" : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"}>{isConnected ? (isDefault ? "Default" : "Configured") : "Setup needed"}</span>
                </div>
                <p className="mt-1 text-xs font-medium text-dls-accent">{instance.model}</p>
                <p className="mt-1 text-xs leading-5 text-dls-secondary">{instance.detail}</p>
                {instance.id === "antigravity-personal" && bridgeExpanded ? <p className="mt-2 rounded-lg bg-dls-surface px-3 py-2 text-xs leading-5 text-dls-secondary">Start Antigravity first, then add its loopback OpenAI-compatible base URL and any bridge token through Other providers or your local OpenCode configuration. Workbench never starts, probes, or invents this bridge.</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {isDefault ? <Button size="sm" variant="secondary" disabled>Default for new sessions</Button>
                    : instance.id === "antigravity-personal" ? <Button size="sm" variant="outline" onClick={() => setBridgeExpanded((value) => !value)}>{bridgeExpanded ? "Hide bridge setup" : "Bridge setup"}</Button>
                    : <Button size="sm" onClick={() => props.onOpenProviderAuth(instance.providerId)}>Configure</Button>}
                  {!isDefault && instance.id !== "antigravity-personal" ? <Button size="sm" variant="ghost" onClick={() => props.onOpenProviderAuth(instance.providerId)}><ExternalLink size={14} /> Open setup</Button> : null}
                </div>
              </div>
            </div>
          </section>;
        })}
      </div>
      <div className="border-t border-dls-border pt-3 text-right"><Button variant="link" size="sm" onClick={() => props.onOpenProviderAuth()}>Other providers</Button></div>
    </DialogContent>
  </Dialog>;
}
