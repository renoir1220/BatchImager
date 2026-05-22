import { normalizeGenerationSizeValue } from "../../electron/generationSizes";

interface GenerationSizeControlProps {
  customValue: string;
  disabled?: boolean;
  idPrefix: string;
  label: string;
  selectedValue: string;
  onCustomValueChange: (value: string) => void;
  onSelectedValueChange: (value: string) => void;
}

const VISUAL_4K_SIZE_OPTIONS = [
  { ariaLabel: "选择 4K 横向比例 16 比 9", shapeClass: "ratio-icon-landscape", value: "3840x2160" },
  { ariaLabel: "选择 4K 竖向比例 9 比 16", shapeClass: "ratio-icon-portrait", value: "2160x3840" }
] as const;

export function GenerationSizeControl({
  disabled,
  idPrefix,
  label,
  selectedValue,
  onCustomValueChange: _onCustomValueChange,
  onSelectedValueChange
}: GenerationSizeControlProps) {
  return (
    <div className="generation-size-control" aria-label={label}>
      <span className="generation-size-label">{label}</span>
      <div className="generation-size-tiles">
        {VISUAL_4K_SIZE_OPTIONS.map((option) => {
          const isSelected = selectedValue === option.value;

          return (
            <button
              aria-label={option.ariaLabel}
              aria-pressed={isSelected}
              className={`generation-size-tile ${isSelected ? "selected" : ""}`}
              disabled={disabled}
              key={option.value}
              type="button"
              onClick={() => onSelectedValueChange(isSelected ? "" : option.value)}
            >
              <span className={`ratio-icon ${option.shapeClass}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function resolveGenerationSizeSelection(selectedValue: string, _customValue: string): string | undefined {
  if (!selectedValue) {
    return undefined;
  }

  return normalizeGenerationSizeValue(selectedValue);
}

export function isGenerationSizeSelectionValid(selectedValue: string, customValue: string): boolean {
  if (!selectedValue) {
    return true;
  }

  return Boolean(resolveGenerationSizeSelection(selectedValue, customValue));
}
