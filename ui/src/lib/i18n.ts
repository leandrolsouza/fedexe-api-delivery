import { useSyncExternalStore } from 'react';
import { messages } from './messages';

export type Locale = 'en-US' | 'pt-BR';
export type Message = keyof typeof messages;

const storageKey = 'fedexe.locale';
const listeners = new Set<() => void>();

function savedLocale(): Locale {
  try {
    return localStorage.getItem(storageKey) === 'pt-BR' ? 'pt-BR' : 'en-US';
  } catch {
    return 'en-US';
  }
}

let locale = savedLocale();
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
  listeners.forEach((listener) => listener());
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return value.toLocaleString(locale, options);
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleString(locale, options);
}

export function t(message: Message, ...values: (string | number)[]): string {
  return (locale === 'pt-BR' ? message : messages[message]).replace(/\{(\d+)\}/g, (_, index) => {
    const value = values[Number(index)];
    return typeof value === 'number' ? formatNumber(value) : String(value);
  });
}
