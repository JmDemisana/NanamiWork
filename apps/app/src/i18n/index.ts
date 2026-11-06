import en from "./locales/en";

export const LANGUAGE_PREF_KEY = "openwork.language";

/**
 * Supported languages (English only)
 */
export type Language = "en" | string;
export type Locale = Language;

/**
 * All supported languages - single source of truth
 */
export const LANGUAGES: Language[] = ["en"];

/**
 * Language options for UI - single source of truth
 */
export const LANGUAGE_OPTIONS = [
  { value: "en" as Language, label: "English", nativeName: "English" },
] as const;

export const pluralSuffix = (_locale: Language, count: number): string => {
  return count === 1 ? "" : "s";
};

/**
 * Translation maps
 */
const TRANSLATIONS: Record<string, Record<string, string>> = {
  en,
};

export const isLanguage = (value: unknown): value is Language => {
  return value === "en";
};

let localeValue: Language = "en";

export const currentLocale = (): Language => locale();
function locale(): Language {
  return localeValue;
}

export const setLocale = (newLocale: Language) => {
  localeValue = "en";
  if (typeof document !== "undefined") {
    document.documentElement.lang = "en";
    try {
      window.localStorage.setItem(LANGUAGE_PREF_KEY, "en");
    } catch {
      // Ignore localStorage errors
    }
  }
};

const lookupEntry = (loc: Language, key: string): string | null => {
  const table = TRANSLATIONS[loc] ?? TRANSLATIONS.en;
  if (table && key in table) {
    return table[key];
  }
  return null;
};

const pluralRulesByLanguage: Record<string, Intl.PluralRules> = {
  en: new Intl.PluralRules("en"),
};
const pluralRule = (loc: Language, count: number): Intl.LDMLPluralRule => {
  const rules = pluralRulesByLanguage[loc] ?? pluralRulesByLanguage.en;
  return rules.select(count);
};

const resolvePluralKey = (loc: Language, key: string, count: number): string => {
  const candidates: string[] = [];
  if (count === 0) candidates.push(`${key}_zero`);
  candidates.push(`${key}_${pluralRule(loc, count)}`, `${key}_other`, key);

  for (const candidate of candidates) {
    if (lookupEntry(loc, candidate) !== null) return candidate;
  }
  return key;
};

export function t(key: string, params?: Record<string, unknown>): string {
  const loc = locale();
  let text: string | null = null;

  if (params && typeof params.count === "number") {
    const pluralKey = resolvePluralKey(loc, key, params.count);
    text = lookupEntry(loc, pluralKey);
    if (text === null && loc !== "en") {
      const fallbackPluralKey = resolvePluralKey("en", key, params.count);
      text = lookupEntry("en", fallbackPluralKey);
    }
  }

  if (text === null) {
    text = lookupEntry(loc, key);
  }

  if (text === null && loc !== "en") {
    text = lookupEntry("en", key);
  }

  if (text === null) {
    return key;
  }

  if (params) {
    let result = text;
    for (const [paramKey, paramValue] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{\\s*${paramKey}\\s*\\}`, "g"), String(paramValue));
    }
    return result;
  }

  return text;
}

export const initLocale = (): Language => {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LANGUAGE_PREF_KEY, "en");
    } catch {
      // Ignore localStorage errors
    }
    document.documentElement.lang = "en";
  }
  return "en";
};

export const detectLocale = (): Language => {
  return "en";
};
