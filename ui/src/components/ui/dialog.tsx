import { t } from '../../lib/i18n';
import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  return (
    <Primitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next || dismissible) onOpenChange(next);
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content className={cn('dialog-content', className)}>
          <div className="dialog-heading">
            <div>
              <Primitive.Title>{title}</Primitive.Title>
              {description && <Primitive.Description>{description}</Primitive.Description>}
            </div>
            <Primitive.Close
              disabled={!dismissible}
              className="button button-ghost button-icon"
              aria-label={t('Fechar')}
            >
              <X size={18} />
            </Primitive.Close>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
