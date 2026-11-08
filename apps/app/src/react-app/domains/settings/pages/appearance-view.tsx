/** @jsxImportSource react */
import type { Language } from "@/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { ThemeSection } from "../appearance/theme-section";
import { LayoutSection, LayoutSectionHeader, LayoutSectionItem, LayoutSectionItemDescription, LayoutSectionItemHeader, LayoutSectionItemHeaderActions, LayoutSectionItemTitle, LayoutSectionTitle, LayoutStack } from "../settings-layout";

export type AppearanceViewProps = {
  busy: boolean;
  themeMode: "light" | "dark" | "system";
  setThemeMode: (value: "light" | "dark" | "system") => void;
  language: Language;
  setLanguage: (value: Language) => void;
  hideTitlebar: boolean;
  toggleHideTitlebar: () => void;
  showPromptNavigation: boolean;
  setShowPromptNavigation: (value: boolean) => void;
};

export function AppearanceView(props: AppearanceViewProps) {
  return (
    <LayoutStack>
      <ThemeSection {...props} />
      <LayoutSection>
        <LayoutSectionHeader><LayoutSectionTitle>Chat display</LayoutSectionTitle></LayoutSectionHeader>
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>Prompt Navigation</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>Show the prompt navigation bar. Keyboard shortcuts remain available.</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Checkbox aria-label="Prompt Navigation" checked={props.showPromptNavigation} disabled={props.busy} onCheckedChange={props.setShowPromptNavigation} />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>
    </LayoutStack>
  );
}
