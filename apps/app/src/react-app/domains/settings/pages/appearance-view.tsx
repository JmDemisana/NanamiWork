/** @jsxImportSource react */
import type { Language } from "@/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import type { PromptNavigationVisibility } from "@/react-app/kernel/local-preferences-storage";
import { ThemeSection } from "../appearance/theme-section";
import { LayoutSection, LayoutSectionHeader, LayoutSectionItem, LayoutSectionItemHeader, LayoutSectionItemHeaderActions, LayoutSectionItemTitle, LayoutSectionTitle, LayoutStack } from "../settings-layout";

export type AppearanceViewProps = {
  busy: boolean;
  themeMode: "light" | "dark" | "system";
  setThemeMode: (value: "light" | "dark" | "system") => void;
  language: Language;
  setLanguage: (value: Language) => void;
  hideTitlebar: boolean;
  toggleHideTitlebar: () => void;
  promptNavigation: PromptNavigationVisibility;
  setPromptNavigation: (key: keyof PromptNavigationVisibility, value: boolean) => void;
};

export function AppearanceView(props: AppearanceViewProps) {
  return (
    <LayoutStack>
      <ThemeSection {...props} />
      <LayoutSection>
        <LayoutSectionHeader><LayoutSectionTitle>Prompt Navigation</LayoutSectionTitle></LayoutSectionHeader>
        {([
          ["top", "Top"],
          ["previous", "Previous Prompt"],
          ["next", "Next Prompt"],
          ["latest", "Latest"],
        ] as const).map(([key, label]) => (
          <LayoutSectionItem key={key}>
            <LayoutSectionItemHeader>
              <LayoutSectionItemTitle>{label}</LayoutSectionItemTitle>
              <LayoutSectionItemHeaderActions>
                <Checkbox aria-label={label} checked={props.promptNavigation[key]} disabled={props.busy} onCheckedChange={(value) => props.setPromptNavigation(key, value)} />
              </LayoutSectionItemHeaderActions>
            </LayoutSectionItemHeader>
          </LayoutSectionItem>
        ))}
      </LayoutSection>
    </LayoutStack>
  );
}
