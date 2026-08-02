/**
 * Shared stream utilities for agent adapters
 */
import { promises as fs } from "fs";
import path from "path";

/**
 * Stream process output to a log file while capturing text.
 */
export async function streamToLog(params: {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  logFile: string;
  appendLog: boolean;
}): Promise<{ stdoutText: string; stderrText: string }> {
  const { stdout, stderr, logFile, appendLog } = params;
  await fs.mkdir(path.dirname(logFile), { recursive: true });

  if (appendLog) {
    const header = `\n${"=".repeat(60)}\n=== New run ===\n${"=".repeat(60)}\n\n`;
    await fs.appendFile(logFile, header, "utf8");
  } else {
    await fs.writeFile(logFile, "", "utf8");
  }

  const readStream = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
    if (!stream) {
      return "";
    }
    const reader = stream.getReader();
    // One decoder per stream, in streaming mode: a multi-byte character split
    // across chunk boundaries must not decode to U+FFFD.
    const decoder = new TextDecoder();
    let output = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      output += chunk;
      await fs.appendFile(logFile, chunk, "utf8");
    }
    const tail = decoder.decode();
    if (tail.length > 0) {
      output += tail;
      await fs.appendFile(logFile, tail, "utf8");
    }
    return output;
  };

  const [stdoutText, stderrText] = await Promise.all([readStream(stdout), readStream(stderr)]);

  return { stdoutText, stderrText };
}
