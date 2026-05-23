import type { ReactNode } from "react";
import * as Select from "@radix-ui/react-select";

export interface OsSelectOption<TValue extends string> {
  description?: string;
  label: string;
  value: TValue;
}

interface OsSelectProps<TValue extends string> {
  ariaLabel: string;
  disabled?: boolean;
  icon?: ReactNode;
  listLabel?: string;
  options: OsSelectOption<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
}

export function OsSelect<TValue extends string>({
  ariaLabel,
  disabled,
  icon,
  listLabel,
  options,
  value,
  onValueChange
}: OsSelectProps<TValue>) {
  return (
    <Select.Root disabled={disabled} value={value} onValueChange={(nextValue) => onValueChange(nextValue as TValue)}>
      <Select.Trigger className="os-select-trigger" aria-label={ariaLabel}>
        {icon ? <span className="composer-tool-icon os-select-leading-icon" aria-hidden="true">{icon}</span> : null}
        <Select.Value className="os-select-value" />
        <Select.Icon className="os-select-caret" aria-hidden="true">
          <ChevronIcon />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          aria-label={listLabel ?? ariaLabel}
          className="os-select-content"
          position="popper"
          side="top"
          align="end"
          sideOffset={7}
        >
          <Select.Viewport className="os-select-viewport">
            {options.map((option) => (
              <Select.Item
                className="os-select-item"
                key={option.value}
                textValue={option.label}
                value={option.value}
              >
                <Select.ItemText>
                  <span className="os-select-item-name">{option.label}</span>
                  {option.description ? <span className="os-select-item-a11y-note"> {option.description}</span> : null}
                </Select.ItemText>
                {option.description ? (
                  <span className="os-select-item-note" aria-hidden="true">
                    {option.description}
                  </span>
                ) : null}
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
      <path d="m3 4.6 3 3 3-3" />
    </svg>
  );
}
