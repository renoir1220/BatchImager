import { GENERATION_SIZE_OPTIONS, normalizeGenerationSizeValue } from "../../electron/generationSizes";

interface GenerationSizeControlProps {
  customValue: string;
  disabled?: boolean;
  idPrefix: string;
  label: string;
  selectedValue: string;
  onCustomValueChange: (value: string) => void;
  onSelectedValueChange: (value: string) => void;
}

export const CUSTOM_GENERATION_SIZE_VALUE = "__custom__";

export function GenerationSizeControl({
  customValue,
  disabled,
  idPrefix,
  label,
  selectedValue,
  onCustomValueChange,
  onSelectedValueChange
}: GenerationSizeControlProps) {
  const customId = `${idPrefix}-custom-size`;
  const isCustom = selectedValue === CUSTOM_GENERATION_SIZE_VALUE;
  const customSize = normalizeGenerationSizeValue(customValue);

  return (
    <div className={`generation-size-control ${isCustom ? "custom" : ""}`}>
      <label className="generation-size-select">
        <span>{label}</span>
        <select value={selectedValue} disabled={disabled} onChange={(event) => onSelectedValueChange(event.target.value)}>
          <option value="">原图尺寸</option>
          {GENERATION_SIZE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value={CUSTOM_GENERATION_SIZE_VALUE}>自定义</option>
        </select>
      </label>
      {isCustom ? (
        <input
          id={customId}
          className="generation-size-custom"
          value={customValue}
          disabled={disabled}
          placeholder="宽x高，如 3000x2000"
          aria-label="自定义分辨率"
          onChange={(event) => onCustomValueChange(event.target.value)}
        />
      ) : null}
      {isCustom && customValue.trim() && !customSize ? <span className="generation-size-error">格式应为 宽x高</span> : null}
    </div>
  );
}

export function resolveGenerationSizeSelection(selectedValue: string, customValue: string): string | undefined {
  if (!selectedValue) {
    return undefined;
  }

  if (selectedValue === CUSTOM_GENERATION_SIZE_VALUE) {
    return normalizeGenerationSizeValue(customValue);
  }

  return normalizeGenerationSizeValue(selectedValue);
}

export function isGenerationSizeSelectionValid(selectedValue: string, customValue: string): boolean {
  if (!selectedValue) {
    return true;
  }

  return Boolean(resolveGenerationSizeSelection(selectedValue, customValue));
}
