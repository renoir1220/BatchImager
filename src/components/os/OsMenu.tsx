import type { ReactElement, ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

interface OsMenuProps {
  align?: "start" | "center" | "end";
  children: ReactNode;
  contentClassName?: string;
  trigger: ReactElement;
}

export function OsMenu({
  align = "start",
  children,
  contentClassName = "",
  trigger
}: OsMenuProps) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          className={`toolbar-popover toolbar-popover-floating ${contentClassName}`.trim()}
          sideOffset={7}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface OsMenuItemProps {
  children: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

export function OsMenuItem({ children, disabled = false, onSelect }: OsMenuItemProps) {
  return (
    <DropdownMenu.Item asChild disabled={disabled} onSelect={onSelect}>
      <button type="button" disabled={disabled}>
        {children}
      </button>
    </DropdownMenu.Item>
  );
}
