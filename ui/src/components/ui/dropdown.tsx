import * as Menu from '@radix-ui/react-dropdown-menu';
import { Fragment, type ReactNode } from 'react';

export function Dropdown({
  trigger,
  items,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  items: {
    label: string;
    icon?: ReactNode;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
    shortcut?: string;
  }[];
}) {
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="dropdown-content" align="end" sideOffset={6}>
          {items.map((item, i) => (
            <Fragment key={i}>
              {item.separatorBefore && <Menu.Separator className="dropdown-separator" />}
              <Menu.Item
                disabled={item.disabled}
                className={`dropdown-item ${item.danger ? 'danger' : ''}`}
                onSelect={item.action}
                textValue={item.label}
              >
                {item.icon}
                {item.label}
                {item.shortcut && <kbd className="dropdown-shortcut">{item.shortcut}</kbd>}
              </Menu.Item>
            </Fragment>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
