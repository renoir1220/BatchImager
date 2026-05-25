import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  findGenerationSizeOption,
  GENERATION_RATIO_LABELS,
  GENERATION_SIZE_OPTIONS,
  normalizeGenerationSizeValue,
  type GenerationRatioLabel,
  type GenerationResolution
} from "../../electron/generationSizes";

interface GenerationSizeControlProps {
  customValue: string;
  disabled?: boolean;
  idPrefix: string;
  label: string;
  selectedValue: string;
  onCustomValueChange: (value: string) => void;
  onSelectedValueChange: (value: string) => void;
}

const GENERATION_SIZE_STORAGE_KEY = "batchimager:generation-size";
const GENERATION_RATIO_STORAGE_KEY = "batchimager:generation-size-ratio";
const GENERATION_RESOLUTION_STORAGE_KEY = "batchimager:generation-size-resolution";
const RESOLUTION_OPTIONS: { label: string; value: GenerationResolution }[] = [
  { label: "1K", value: "1k" },
  { label: "2K", value: "2k" },
  { label: "4K", value: "4k" }
];

export function GenerationSizeControl({
  disabled,
  idPrefix,
  label,
  selectedValue,
  onCustomValueChange: _onCustomValueChange,
  onSelectedValueChange
}: GenerationSizeControlProps) {
  const controlRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeResolution, setActiveResolution] = useState<GenerationResolution>(() => readStoredResolution() ?? "1k");
  const [activeRatio, setActiveRatio] = useState<GenerationRatioLabel>(() => readStoredRatio() ?? "1:1");
  const selectedOption = useMemo(
    () => GENERATION_SIZE_OPTIONS.find((option) => option.value === selectedValue) ?? null,
    [selectedValue]
  );
  const selectedLabel = selectedOption?.shortLabel ?? "自动";

  useEffect(() => {
    const storedSize = readStoredSize();

    if (!selectedValue && storedSize) {
      const storedOption = GENERATION_SIZE_OPTIONS.find((option) => option.value === storedSize);
      if (storedOption) {
        setActiveResolution(storedOption.resolution);
        setActiveRatio(storedOption.ratioLabel);
        onSelectedValueChange(storedOption.value);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedOption) {
      setActiveResolution(selectedOption.resolution);
      setActiveRatio(selectedOption.ratioLabel);
    }
  }, [selectedOption]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleWindowPointerDown(event: PointerEvent): void {
      if (!controlRef.current?.contains(event.target as Node | null)) {
        setIsOpen(false);
      }
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handleWindowPointerDown);
    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [isOpen]);

  function selectResolution(resolution: GenerationResolution): void {
    setActiveResolution(resolution);
    writeStoredResolution(resolution);
    selectSizeFor(resolution, activeRatio);
  }

  function selectRatio(ratio: GenerationRatioLabel): void {
    setActiveRatio(ratio);
    writeStoredRatio(ratio);
    selectSizeFor(activeResolution, ratio);
    setIsOpen(false);
  }

  function selectSizeFor(resolution: GenerationResolution, ratio: GenerationRatioLabel): void {
    const option = findGenerationSizeOption(resolution, ratio);
    if (!option) {
      return;
    }

    onSelectedValueChange(option.value);
    writeStoredSize(option.value);
    writeStoredResolution(option.resolution);
    writeStoredRatio(option.ratioLabel);
  }

  function selectAuto(): void {
    onSelectedValueChange("");
    writeStoredSize("");
    setIsOpen(false);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
    }
  }

  return (
    <div className="generation-size-control" aria-label={label} ref={controlRef}>
      <button
        className="composer-tool-icon generation-size-heading-icon"
        type="button"
        title={`${label}${selectedLabel}`}
        aria-label={`${label}${selectedLabel}`}
        aria-expanded={isOpen}
        aria-controls={`${idPrefix}-generation-size-popover`}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <GenerationSizeIcon />
      </button>
      <button
        className="generation-size-current"
        type="button"
        disabled={disabled}
        aria-label={`当前生成尺寸：${selectedLabel}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className={`ratio-icon ${getRatioShapeClass(selectedOption?.ratioLabel)}`} aria-hidden="true" />
        <span>{selectedLabel}</span>
      </button>
      {isOpen ? (
        <div className="generation-size-popover" id={`${idPrefix}-generation-size-popover`} role="dialog" aria-label="选择生成尺寸">
          <header>
            <strong>生成尺寸</strong>
            <button className={!selectedValue ? "selected" : ""} type="button" aria-pressed={!selectedValue} onClick={selectAuto}>
              自动
            </button>
          </header>
          <div className="generation-resolution-tabs" role="tablist" aria-label="分辨率">
            {RESOLUTION_OPTIONS.map((option) => (
              <button
                className={activeResolution === option.value ? "selected" : ""}
                key={option.value}
                role="tab"
                type="button"
                aria-selected={activeResolution === option.value}
                onClick={() => selectResolution(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="generation-ratio-grid" role="listbox" aria-label="比例">
            {GENERATION_RATIO_LABELS.map((ratioLabel) => {
              const option = findGenerationSizeOption(activeResolution, ratioLabel);
              if (!option) {
                return null;
              }
              const isSelected = selectedValue === option.value;

              return (
                <button
                  className={`generation-ratio-option ${isSelected ? "selected" : ""}`}
                  key={option.value}
                  role="option"
                  type="button"
                  aria-selected={isSelected}
                  onClick={() => selectRatio(ratioLabel)}
                >
                  <span className={`ratio-icon ${getRatioShapeClass(option.ratioLabel)}`} aria-hidden="true" />
                  <span>
                    <strong>{option.ratioLabel}</strong>
                    <em>{option.value}</em>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GenerationSizeIcon() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M4.2 5.8h11.6" />
      <path d="M4.2 10h11.6" />
      <path d="M4.2 14.2h11.6" />
      <path d="M7 4.4v2.8" />
      <path d="M13.1 8.6v2.8" />
      <path d="M9.7 12.8v2.8" />
    </svg>
  );
}

function getRatioShapeClass(ratioLabel: string | undefined): string {
  if (ratioLabel === "1:1") {
    return "ratio-icon-square";
  }

  if (ratioLabel === "2:3" || ratioLabel === "9:16") {
    return "ratio-icon-portrait";
  }

  return "ratio-icon-landscape";
}

function readStoredSize(): string | undefined {
  try {
    const value = window.localStorage.getItem(GENERATION_SIZE_STORAGE_KEY);
    return normalizeGenerationSizeValue(value ?? undefined);
  } catch {
    return undefined;
  }
}

function writeStoredSize(value: string): void {
  try {
    if (value) {
      window.localStorage.setItem(GENERATION_SIZE_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(GENERATION_SIZE_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable in restricted renderer contexts.
  }
}

function readStoredRatio(): GenerationRatioLabel | undefined {
  try {
    const value = window.localStorage.getItem(GENERATION_RATIO_STORAGE_KEY);
    return GENERATION_RATIO_LABELS.includes(value as GenerationRatioLabel) ? (value as GenerationRatioLabel) : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredRatio(value: GenerationRatioLabel): void {
  try {
    window.localStorage.setItem(GENERATION_RATIO_STORAGE_KEY, value);
  } catch {
    // localStorage may be unavailable in restricted renderer contexts.
  }
}

function readStoredResolution(): GenerationResolution | undefined {
  try {
    const value = window.localStorage.getItem(GENERATION_RESOLUTION_STORAGE_KEY);
    return value === "1k" || value === "2k" || value === "4k" ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredResolution(value: GenerationResolution): void {
  try {
    window.localStorage.setItem(GENERATION_RESOLUTION_STORAGE_KEY, value);
  } catch {
    // localStorage may be unavailable in restricted renderer contexts.
  }
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
