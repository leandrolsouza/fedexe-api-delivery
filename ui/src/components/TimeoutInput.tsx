import { toast } from 'sonner';
import { t } from '../lib/i18n';
import { MAX_TIMEOUT_MS, validTimeout } from '../lib/models';

export function TimeoutInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value?: number;
  placeholder?: string;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <input
        key={value ?? 'default'}
        className="input"
        type="number"
        min={1}
        max={MAX_TIMEOUT_MS}
        step={1}
        defaultValue={value}
        placeholder={placeholder}
        onBlur={({ currentTarget: input }) => {
          const next = input.valueAsNumber;
          if (input.validity.badInput || (input.value !== '' && !validTimeout(next))) {
            input.value = value?.toString() ?? '';
            toast.error(t('O timeout deve ficar entre 1 e 600.000 ms.'));
            return;
          }
          const timeout = input.value === '' ? undefined : next;
          if (timeout !== value) onChange(timeout);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
