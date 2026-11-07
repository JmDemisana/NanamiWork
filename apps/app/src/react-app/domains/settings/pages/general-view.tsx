/** @jsxImportSource react */
import {
  ArrowRight,
  Cog,
  FolderLock,
  Keyboard,
  Paintbrush,
  Sparkles,
  Terminal,
  RefreshCcw,
} from "lucide-react";

import type { SettingsTab } from "../../../../app/types";
import { openWorkbenchInstancesEvent } from "../../../shell/new-providers-listener";

export type GeneralSettingsViewProps = {
  onNavigateTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  onSendFeedback: () => void;
  onJoinDiscord: () => void;
  onReportIssue: () => void;
};

type SettingsCardDefinition = { tab: SettingsTab; icon: typeof Sparkles; title: string; desc: string };

const workspaceCards: SettingsCardDefinition[] = [
  { tab: "preferences", icon: Cog, title: "Preferences", desc: "Default model, reasoning, and compaction." },
  { tab: "permissions", icon: FolderLock, title: "Permissions", desc: "Authorized folders and file access." },
];

const globalCards: SettingsCardDefinition[] = [
  { tab: "appearance", icon: Paintbrush, title: "Appearance", desc: "Theme, font size, and display." },
  { tab: "shortcuts", icon: Keyboard, title: "Keyboard shortcuts", desc: "Keys that switch to your saved models." },
  { tab: "environment", icon: Terminal, title: "Environment", desc: "Environment variables and paths." },
  { tab: "updates", icon: RefreshCcw, title: "Updates", desc: "Check for NanamiWork updates and releases." },
];

function SettingsCard(props: {
  icon: typeof Sparkles;
  title: string;
  desc: string;
  index: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{ animationDelay: `${props.index * 40}ms` }}
      className="nanami-rise group flex items-center gap-3 rounded-2xl border border-dls-border bg-dls-surface p-4 text-left transition-[background-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-dls-hover hover:shadow-[0_6px_18px_-10px_rgba(0,0,0,0.55)] motion-reduce:transform-none motion-reduce:transition-none"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover transition-colors duration-200 group-hover:border-dls-secondary/40">
        <props.icon size={16} className="text-dls-secondary transition-colors duration-200 group-hover:text-dls-text" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-dls-text">{props.title}</div>
        <div className="text-[11px] text-dls-secondary">{props.desc}</div>
      </div>
      <ArrowRight
        size={14}
        className="shrink-0 text-dls-secondary transition-transform duration-200 ease-out group-hover:translate-x-0.5"
      />
    </button>
  );
}

function SettingsGroup(props: { label: string; cards: SettingsCardDefinition[]; onNavigateTab: (tab: SettingsTab) => void }) {
  return (
    <div className="space-y-3">
      <div className="nanami-fade text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">
        {props.label}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {props.cards.map((card, index) => (
          <SettingsCard
            key={card.tab}
            icon={card.icon}
            title={card.title}
            desc={card.desc}
            index={index}
            onClick={() => {
              if (card.tab === ("instances" as any)) {
                window.dispatchEvent(new Event(openWorkbenchInstancesEvent));
              } else {
                props.onNavigateTab(card.tab);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function GeneralSettingsView(props: GeneralSettingsViewProps) {
  return (
    <div className="w-full max-w-3xl space-y-8">
      <SettingsGroup label="Workspace" cards={workspaceCards} onNavigateTab={props.onNavigateTab} />
      <SettingsGroup label="Global" cards={globalCards} onNavigateTab={props.onNavigateTab} />
    </div>
  );
}
