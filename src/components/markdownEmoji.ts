const EMOJI_SHORTCODES: Record<string, string> = {
  art: "🎨",
  bulb: "💡",
  camera: "📷",
  check: "✅",
  eyes: "👀",
  fire: "🔥",
  heart: "❤️",
  hourglass_flowing_sand: "⏳",
  mag: "🔍",
  memo: "📝",
  package: "📦",
  point_right: "👉",
  repeat: "🔁",
  rocket: "🚀",
  smile: "😄",
  sparkles: "✨",
  star: "⭐",
  tada: "🎉",
  warning: "⚠️",
  white_check_mark: "✅",
  x: "❌",
  zap: "⚡"
};

const CODE_SEGMENT_PATTERN = /(```[\s\S]*?```|`[^`\n]*`)/g;
const EMOJI_SHORTCODE_PATTERN = /(^|[^A-Za-z0-9_]):([A-Za-z0-9_+-]+):(?![A-Za-z0-9_])/g;

export function renderEmojiShortcodes(content: string): string {
  return content
    .split(CODE_SEGMENT_PATTERN)
    .map((segment) => {
      if (segment.startsWith("`")) {
        return segment;
      }

      return segment.replace(EMOJI_SHORTCODE_PATTERN, (match, prefix: string, name: string) => {
        const emoji = EMOJI_SHORTCODES[name.toLowerCase()];
        return emoji ? `${prefix}${emoji}` : match;
      });
    })
    .join("");
}
