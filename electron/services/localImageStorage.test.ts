import { describe, expect, test } from "vitest";
import { saveReferenceImage } from "./localImageStorage";

describe("localImageStorage", () => {
  test("stores a pasted reference image under the references directory", async () => {
    const writes: Array<{ data: Uint8Array; path: string }> = [];

    const result = await saveReferenceImage(
      {
        data: new Uint8Array([1, 2, 3]).buffer,
        fileName: "room paste.png",
        mimeType: "image/png"
      },
      {
        makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
        outputDirectory: "C:\\batchimager\\references",
        writeFile: async (filePath, data) => {
          writes.push({ path: filePath, data: new Uint8Array(data) });
        }
      }
    );

    expect(result.filePath).toBe("C:\\batchimager\\references\\reference-2026-05-21T13-00-00-000Z-room-paste.png");
    expect(result.fileName).toBe("room paste.png");
    expect(writes).toEqual([
      {
        data: new Uint8Array([1, 2, 3]),
        path: "C:\\batchimager\\references\\reference-2026-05-21T13-00-00-000Z-room-paste.png"
      }
    ]);
  });

  test("rejects non-image reference payloads", async () => {
    await expect(
      saveReferenceImage(
        {
          data: new Uint8Array([1]).buffer,
          fileName: "notes.txt",
          mimeType: "text/plain"
        },
        {
          makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
          outputDirectory: "C:\\batchimager\\references",
          writeFile: async () => undefined
        }
      )
    ).rejects.toThrow("Reference image must be an image");
  });
});
