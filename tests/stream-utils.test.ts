import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "bun:test";

import { streamToLog } from "../src/adapters/stream-utils";

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("streamToLog", () => {
  it("decodes multi-byte UTF-8 split across chunks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-stream-"));
    try {
      const text = "计划文档";
      const bytes = new TextEncoder().encode(text);
      // Split inside the second character's 3-byte sequence
      const chunks = [bytes.slice(0, 4), bytes.slice(4)];
      const logFile = path.join(root, "stream.log");

      const { stdoutText, stderrText } = await streamToLog({
        stdout: streamFromChunks(chunks),
        stderr: null,
        logFile,
        appendLog: false,
      });

      expect(stdoutText).toBe(text);
      expect(stdoutText).not.toContain("�");
      expect(stderrText).toBe("");
      const logContent = await fs.readFile(logFile, "utf8");
      expect(logContent).toBe(text);
      expect(logContent).not.toContain("�");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
