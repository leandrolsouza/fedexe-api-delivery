import type { Workspace } from './models';
import { isTheme } from './themes';

const key = 'fedexe.app-preferences';
export function appPreferences(settings: Workspace['settings']) {
  const { theme, manualTheme, lightTheme, darkTheme, compact, wrap } = settings;
  return { theme, manualTheme, lightTheme, darkTheme, compact, wrap };
}
export function saveAppPreferences(settings: Workspace['settings']) {
  localStorage.setItem(key, JSON.stringify(appPreferences(settings)));
}
export function applyAppPreferences(workspace: Workspace): Workspace {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      saveAppPreferences(workspace.settings);
      return workspace;
    }
    const value = JSON.parse(raw);
    if (
      !value ||
      (value.theme !== 'system' && !isTheme(value.theme)) ||
      typeof value.compact !== 'boolean' ||
      typeof value.wrap !== 'boolean'
    )
      return workspace;
    return {
      ...workspace,
      settings: {
        ...workspace.settings,
        theme: value.theme,
        compact: value.compact,
        wrap: value.wrap,
        manualTheme: isTheme(value.manualTheme) ? value.manualTheme : undefined,
        lightTheme: isTheme(value.lightTheme, 'light') ? value.lightTheme : undefined,
        darkTheme: isTheme(value.darkTheme, 'dark') ? value.darkTheme : undefined,
      },
    };
  } catch {
    return workspace;
  }
}
