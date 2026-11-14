import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

export function Dropdown({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: {
    label: string;
    icon?: ReactNode;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="dropdown-content" align="end" sideOffset={6}>
          {items.map((item, i) => (
            <Menu.Item
              key={i}
              disabled={item.disabled}
              className={`dropdown-item ${item.danger ? 'danger' : ''}`}
              onSelect={item.action}
            >
              {item.icon}
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
