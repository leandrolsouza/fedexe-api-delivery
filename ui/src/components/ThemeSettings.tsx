import { useId } from 'react';
import { Check } from 'lucide-react';
import { t } from '../lib/i18n';
import { isTheme, themes, type ColorScheme, type ThemeId, type ThemeSettings } from '../lib/themes';

function ThemeGallery({
  label,
  value,
  scheme,
  onSelect,
}: {
  label: string;
  value: ThemeId;
  scheme?: ColorScheme;
  onSelect: (theme: ThemeId) => void;
}) {
  const group = useId();
  return (
    <fieldset className="theme-gallery">
      <legend>{label}</legend>
      <div className="theme-grid">
        {Object.keys(themes)
          .filter((id) => isTheme(id, scheme))
          .map((id) => (
            <label className="theme-card" key={id}>
              <input
                className="sr-only"
                type="radio"
                name={group}
                checked={id === value}
                onChange={() => onSelect(id)}
              />
              <span
                className="theme-sample"
                data-theme={themes[id].scheme}
                data-palette={id}
                aria-hidden="true"
              >
                <span className="theme-sample-header">Fedexe API</span>
                <span className="theme-sample-body">
                  <span className="theme-sample-sidebar">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="theme-sample-editor">
                    <span className="theme-sample-request">
                      <span>/users</span>
                      <span>{t('Enviar')}</span>
                    </span>
                    <code>
                      {'{ '}
                      <span className="syntax-key">"ok"</span>
                      {': '}
                      <span className="syntax-boolean">true</span>
                      {' }'}
                    </code>
                  </span>
                </span>
              </span>
              <span className="theme-card-label">
                {t(themes[id].label)}
                {id === value && <Check size={15} aria-hidden="true" />}
              </span>
            </label>
          ))}
      </div>
    </fieldset>
  );
}

export function ThemeSettingsPanel({
  settings,
  onChange,
}: {
  settings: ThemeSettings;
  onChange: (patch: Partial<ThemeSettings>) => void;
}) {
  const group = useId();
  const system = settings.theme === 'system';
  const manualTheme =
    settings.theme === 'system' ? (settings.manualTheme ?? 'light') : settings.theme;
  return (
    <section className="surface settings-surface theme-settings">
      <div className="settings-section-heading">
        <h2>{t('Temas')}</h2>
      </div>
      <fieldset className="theme-mode">
        <legend>{t('Modo de aparência')}</legend>
        <label>
          <input
            type="radio"
            name={group}
            checked={!system}
            onChange={() => onChange({ theme: manualTheme })}
          />
          {t('Manual')}
        </label>
        <label>
          <input
            type="radio"
            name={group}
            checked={system}
            onChange={() => onChange({ theme: 'system', manualTheme })}
          />
          {t('Seguir o sistema')}
        </label>
      </fieldset>
      {settings.theme === 'system' ? (
        <>
          <ThemeGallery
            label={t('Tema claro do sistema')}
            scheme="light"
            value={settings.lightTheme ?? 'light'}
            onSelect={(lightTheme) => onChange({ lightTheme })}
          />
          <ThemeGallery
            label={t('Tema escuro do sistema')}
            scheme="dark"
            value={settings.darkTheme ?? 'dark'}
            onSelect={(darkTheme) => onChange({ darkTheme })}
          />
        </>
      ) : (
        <ThemeGallery
          label={t('Tema do Fedexe')}
          value={settings.theme}
          onSelect={(theme) => onChange({ theme })}
        />
      )}
    </section>
  );
}
