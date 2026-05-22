import type { PastedReferenceImage } from "./usePastedReferenceImages";

interface ComposerReferenceStripProps {
  images: PastedReferenceImage[];
  isSaving: boolean;
  error: string | null;
  onRemove: (filePath: string) => void;
}

export function ComposerReferenceStrip({ error, images, isSaving, onRemove }: ComposerReferenceStripProps) {
  if (images.length === 0 && !isSaving && !error) {
    return null;
  }

  return (
    <div className="composer-reference-panel">
      {images.length > 0 ? (
        <div className="reference-strip compact">
          {images.map((image) => (
            <button
              className="reference-thumb"
              key={image.filePath}
              type="button"
              aria-label={`移除参考图 ${image.fileName}`}
              onClick={() => onRemove(image.filePath)}
            >
              <img src={image.previewUrl} alt={image.fileName} draggable={false} />
              <span>×</span>
            </button>
          ))}
        </div>
      ) : null}
      {isSaving ? <div className="composer-reference-note">正在保存参考图...</div> : null}
      {error ? <div className="composer-reference-error">{error}</div> : null}
    </div>
  );
}
