import { useSyncExternalStore } from 'react';
import { messages } from './messages';
import { translations } from './translations';

export const localeNames = {
  'en-US': 'English (US)',
  'pt-BR': 'Português (Brasil)',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
} as const;
export type Locale = keyof typeof localeNames;
export type Message = keyof typeof messages;

const storageKey = 'fedexe.locale';
const listeners = new Set<() => void>();

function savedLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved && Object.hasOwn(localeNames, saved) ? (saved as Locale) : 'en-US';
  } catch {
    return 'en-US';
  }
}

let locale = savedLocale();
if (typeof document !== 'undefined') document.documentElement.lang = locale;
const getLocale = () => locale;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale);
}

export function setLocale(next: Locale) {
  localStorage.setItem(storageKey, next);
  locale = next;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  listeners.forEach((listener) => listener());
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return value.toLocaleString(locale, options);
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleString(locale, options);
}

export function t(message: Message, ...values: (string | number)[]): string {
  const template =
    locale === 'pt-BR'
      ? message
      : locale === 'en-US'
        ? messages[message]
        : translations[message][locale];
  return template.replace(/\{(\d+)\}/g, (_, index) => {
    const value = values[Number(index)];
    return typeof value === 'number' ? formatNumber(value) : String(value);
  });
}
