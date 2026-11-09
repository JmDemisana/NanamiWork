/** @jsxImportSource react */
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { t } from "@/i18n";
import { isElectronRuntime } from "@/app/utils";
import { isLinkOpenDestination, type LinkOpenDestination } from "@/react-app/kernel/local-preferences-storage";
import {
  DESKTOP_NOTIFICATION_PREFERENCE_VALUES,
  isDesktopNotificationPreference,
  type DesktopNotificationPreference,
} from "@/react-app/kernel/desktop-notification-preferences";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";
import { DesktopIntegrationSection } from "../desktop-integration-section";
import { useDesktopFeature } from "@/react-app/domains/session/status/use-desktop-feature";
import { useLocalModelPickerPreference } from "@/react-app/domains/models/local-model-picker-preference";
import {
  AUTO_SETTLE_DAY_OPTIONS,
  useSessionManagementStore,
} from "@/react-app/domains/session/sidebar/session-management-store";

export type PreferencesViewProps = {
  busy: boolean;
  keepAwake: boolean;
  onToggleKeepAwake: () => void;
  desktopNotifications: DesktopNotificationPreference;
  onDesktopNotificationsChange: (value: DesktopNotificationPreference) => void;
  linkOpenDestination: LinkOpenDestination;
  onLinkOpenDestinationChange: (value: LinkOpenDestination) => void;
};

function desktopNotificationPreferenceLabel(value: DesktopNotificationPreference) {
  switch (value) {
    case "important":
      return t("settings.desktop_notifications.important");
    case "all":
      return t("settings.desktop_notifications.all");
    case "off":
      return t("settings.desktop_notifications.off");
  }
}

function autoSettleLabel(days: number) {
  return days === 0 ? t("settings.auto_settle.never") : t("settings.auto_settle.days", { count: days });
}

/** Idle sessions move to their workspace's Settled row after this long. */
function AutoSettleSettings() {
  return useDesktopFeature("settledSessions") ? <AutoSettleSection /> : null;
}

function AutoSettleSection() {
  const autoSettleDays = useSessionManagementStore((state) => state.autoSettleDays);
  const setAutoSettleDays = useSessionManagementStore((state) => state.setAutoSettleDays);
  const items = AUTO_SETTLE_DAY_OPTIONS.map((days) => ({ value: String(days), label: autoSettleLabel(days) }));

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.sessions_title")}</LayoutSectionTitle>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader className="min-h-10 items-center">
          <LayoutSectionItemTitle>{t("settings.auto_settle.title")}</LayoutSectionItemTitle>
          <LayoutSectionItemHeaderActions className="self-center">
            <Select
              value={String(autoSettleDays)}
              items={items}
              onValueChange={(value) => {
                if (typeof value === "string") setAutoSettleDays(Number(value));
              }}
            >
              <SelectTrigger className="w-44" aria-label={t("settings.auto_settle.title")} data-auto-settle-select>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>
    </LayoutSection>
  );
}

function LocalModelPickerSettings() {
  const enabled = useLocalModelPickerPreference((state) => state.enabled);
  const setEnabled = useLocalModelPickerPreference((state) => state.setEnabled);
  return <LayoutSection>
    <LayoutSectionHeader><LayoutSectionTitle>Model picker</LayoutSectionTitle></LayoutSectionHeader>
    <LayoutSectionItem>
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>Full-page model picker</LayoutSectionItemTitle>
        <LayoutSectionItemDescription>Use the full-page picker and local router. Turn off to restore the previous picker. Managed organizations may restrict this feature.</LayoutSectionItemDescription>
        <LayoutSectionItemHeaderActions>
          <Switch aria-label="Full-page model picker" checked={enabled} onCheckedChange={setEnabled} />
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>
    </LayoutSectionItem>
  </LayoutSection>;
}

export function PreferencesView(props: PreferencesViewProps) {
  const linkDestinationItems = [
    { value: "openwork", label: "NanamiWork" },
    { value: "external", label: t("settings.links.external") },
  ];
  const desktopNotificationItems = DESKTOP_NOTIFICATION_PREFERENCE_VALUES.map((value) => ({
    value,
    label: desktopNotificationPreferenceLabel(value),
  }));

  return (
    <LayoutStack>
      <AutoSettleSettings />
      {isElectronRuntime() ? <LocalModelPickerSettings /> : null}

      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.desktop_notifications.title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.desktop_notifications.section_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.desktop_notifications.mode")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.desktop_notifications.mode_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <div className="w-44 max-w-full">
                <Select
                  value={props.desktopNotifications}
                  items={desktopNotificationItems}
                  onValueChange={(value) => {
                    if (isDesktopNotificationPreference(value)) {
                      props.onDesktopNotificationsChange(value);
                    }
                  }}
                  disabled={props.busy}
                >
                  <SelectTrigger className="w-full" aria-label={t("settings.desktop_notifications.mode")}>
                    <SelectValue placeholder={t("settings.desktop_notifications.off")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {DESKTOP_NOTIFICATION_PREFERENCE_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {desktopNotificationPreferenceLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>

      {isElectronRuntime() ? (
        <LayoutSection>
          <LayoutSectionHeader>
            <LayoutSectionTitle>{t("settings.power_title")}</LayoutSectionTitle>
          </LayoutSectionHeader>

          <LayoutSectionItem>
            <LayoutSectionItemHeader>
              <LayoutSectionItemTitle>{t("settings.keep_awake")}</LayoutSectionItemTitle>
              <LayoutSectionItemDescription>{t("settings.keep_awake_desc")}</LayoutSectionItemDescription>
              <LayoutSectionItemHeaderActions>
                <Switch
                  aria-label={t("settings.keep_awake")}
                  checked={props.keepAwake}
                  disabled={props.busy}
                  onCheckedChange={props.onToggleKeepAwake}
                />
              </LayoutSectionItemHeaderActions>
            </LayoutSectionItemHeader>
          </LayoutSectionItem>
        </LayoutSection>
      ) : null}

      <DesktopIntegrationSection />

      {isElectronRuntime() ? (
        <LayoutSection>
          <LayoutSectionHeader>
            <LayoutSectionTitle>{t("settings.browser_title")}</LayoutSectionTitle>
            <LayoutSectionDescription>{t("settings.browser_section_desc")}</LayoutSectionDescription>
          </LayoutSectionHeader>

          <LayoutSectionItem>
            <LayoutSectionItemHeader className="min-h-10 items-center">
              <LayoutSectionItemTitle>{t("settings.links.open_in")}</LayoutSectionItemTitle>
              <LayoutSectionItemDescription>{t("settings.links.open_in_desc")}</LayoutSectionItemDescription>
              <LayoutSectionItemHeaderActions className="self-center">
                <Select
                  value={props.linkOpenDestination}
                  items={linkDestinationItems}
                  onValueChange={(value) => {
                    if (isLinkOpenDestination(value)) props.onLinkOpenDestinationChange(value);
                  }}
                >
                  <SelectTrigger className="w-44" aria-label={t("settings.links.open_in")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {linkDestinationItems.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </LayoutSectionItemHeaderActions>
            </LayoutSectionItemHeader>
          </LayoutSectionItem>
        </LayoutSection>
      ) : null}

    </LayoutStack>
  );
}
