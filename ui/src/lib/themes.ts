export const themes = {
  light: { label: 'Fedexe Claro', scheme: 'light' },
  'github-light': { label: 'GitHub Light', scheme: 'light' },
  'ayu-light': { label: 'Ayu Light', scheme: 'light' },
  dark: { label: 'Fedexe Escuro', scheme: 'dark' },
  dracula: { label: 'Dracula', scheme: 'dark' },
  'catppuccin-mocha': { label: 'Catppuccin Mocha', scheme: 'dark' },
} as const;

export type ThemeId = keyof typeof themes;
export type ColorScheme = 'light' | 'dark';
export type ThemeSettings = {
  theme: ThemeId | 'system';
  manualTheme?: ThemeId;
  lightTheme?: ThemeId;
  darkTheme?: ThemeId;
};

export function isTheme(value: unknown, scheme?: ColorScheme): value is ThemeId {
  return (
    typeof value === 'string' &&
    Object.hasOwn(themes, value) &&
    (scheme === undefined || themes[value as ThemeId].scheme === scheme)
  );
}

export function resolveTheme(settings: ThemeSettings, systemScheme: ColorScheme): ThemeId {
  if (settings.theme !== 'system') return settings.theme;
  return systemScheme === 'dark'
    ? (settings.darkTheme ?? 'dark')
    : (settings.lightTheme ?? 'light');
}
