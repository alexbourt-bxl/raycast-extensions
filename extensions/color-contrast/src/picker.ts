import { Clipboard, environment, showToast, Toast } from "@raycast/api";

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parsePickedColor } from "./color";

import type { PixelPickResult } from "./types";
import { isPixelPickResult, isPartialPixelPickResult } from "./types";

let isPickInFlight = false;

export type PickStateSetters = {
  setIsPicking: (value: boolean) => void;
  setForegroundHex: (value: string) => void;
  setBackgroundHex: (value: string) => void;
};

export async function pickTwoPixelsWithResult(setters: PickStateSetters): Promise<PixelPickResult | null> {
  if (process.platform !== "win32" && process.platform !== "darwin") {
    await pickTwoColorsFromClipboard(setters);
    return null;
  }

  if (isPickInFlight) {
    return null;
  }
  isPickInFlight = true;

  if (setters.setIsPicking) {
    setters.setIsPicking(true);
  }

  try {
    setters.setForegroundHex("");
    setters.setBackgroundHex("");

    await showToast({
      style: Toast.Style.Animated,
      title: "Click foreground pixel, then background pixel.",
      message: "Press Esc to cancel.",
    });

    const result = await runPixelPicker({
      timeoutMs: 60000,
      onProgress: (progress) => {
        if (progress.foreground?.hex) {
          setters.setForegroundHex(progress.foreground.hex);
        }

        if (progress.background?.hex) {
          setters.setBackgroundHex(progress.background.hex);
        }
      },
    });

    setters.setForegroundHex(result.foreground.hex);
    setters.setBackgroundHex(result.background.hex);

    await showToast({
      style: Toast.Style.Success,
      title: "Picked two pixels",
      message: `${result.foreground.hex} on ${result.background.hex}`,
    });

    return result;
  } catch (error) {
    const message = String(error);
    const isCancel = message.includes("PICKER_CANCELED");

    const toastMessage = isCancel
      ? "Press “Pick Two Pixels” to try again."
      : formatPickerFailureMessage({
          platform: process.platform,
          message,
        });

    await showToast({
      style: Toast.Style.Failure,
      title: isCancel ? "Canceled" : "Failed to pick pixels",
      message: toastMessage,
    });

    return null;
  } finally {
    setters.setIsPicking(false);
    isPickInFlight = false;
  }
}

async function pickTwoColorsFromClipboard(setters: PickStateSetters): Promise<void> {
  if (isPickInFlight) {
    return;
  }
  isPickInFlight = true;

  setters.setIsPicking(true);

  try {
    const text = await Clipboard.readText();
    const parsed = parseTwoColorsFromText(text ?? "");

    setters.setForegroundHex(parsed.foreground);
    setters.setBackgroundHex(parsed.background);

    await showToast({
      style: Toast.Style.Success,
      title: "Loaded two colors from clipboard",
      message: `${parsed.foreground} on ${parsed.background}`,
    });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Clipboard doesn't contain two colors",
      message: "Copy two colors like “#ffffff\n#000000” or “#ffffff on #000000”, then run “Pick Two Pixels” again.",
    });

    if (error) {
      // keep signature stable
    }
  } finally {
    setters.setIsPicking(false);
    isPickInFlight = false;
  }
}

function parseTwoColorsFromText(text: string): {
  foreground: string;
  background: string;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Empty clipboard");
  }

  const hexMatches = trimmed.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})/g);
  if (hexMatches && hexMatches.length >= 2) {
    return {
      foreground: parsePickedColor(hexMatches[0]).hex,
      background: parsePickedColor(hexMatches[1]).hex,
    };
  }

  const parts = trimmed
    .replace(/\bon\b/gi, "\n")
    .split(/[\r\n,;]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const picked: string[] = [];
  for (const part of parts) {
    try {
      picked.push(parsePickedColor(part).hex);
    } catch {
      // Skip invalid color strings; we'll validate we have at least 2 valid colors below
    }
  }

  if (picked.length < 2) {
    throw new Error("Not enough colors");
  }

  return {
    foreground: picked[0],
    background: picked[1],
  };
}

type RunPixelPickerParams = {
  timeoutMs: number;
  onProgress?: (progress: Partial<PixelPickResult>) => void;
};

async function runPixelPicker(params: RunPixelPickerParams): Promise<PixelPickResult> {
  const outFilePath = join(environment.supportPath, `pixel-picker-result-${Date.now()}.json`);
  const args = ["--timeout-ms", String(params.timeoutMs), "--out", outFilePath];

  if (process.platform === "darwin") {
    const pickerExePath = join(environment.assetsPath, "mac");

    try {
      return await runPixelPickerExeStreaming({
        exePath: pickerExePath,
        args,
        timeoutMs: params.timeoutMs,
        outFilePath,
        onProgress: params.onProgress,
      });
    } catch (error) {
      const message = String(error);
      const isMissingExe = message.includes("ENOENT") || message.includes("not found");
      if (isMissingExe) {
        throw new Error("Missing mac helper. Run scripts/build-mac.sh and ensure assets/mac is executable.");
      }

      throw error;
    }
  }

  const pickerExePath = join(environment.assetsPath, "win.exe");

  try {
    return await runPixelPickerExeStreaming({
      exePath: pickerExePath,
      args,
      timeoutMs: params.timeoutMs,
      outFilePath,
      onProgress: params.onProgress,
    });
  } catch (error) {
    const message = String(error);
    const isMissingExe = message.includes("ENOENT") || message.includes("not found");
    if (isMissingExe) {
      throw new Error("Missing win.exe helper. Ensure assets/win.exe exists.");
    }

    throw error;
  }
}

function parsePixelPickerJson(stdout: string): PixelPickResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Pixel picker returned no output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Pixel picker returned invalid JSON: ${trimmed}`);
  }

  if (!isPixelPickResult(parsed)) {
    throw new Error(`Pixel picker returned invalid result structure: ${trimmed}`);
  }

  // Normalize hex values to uppercase
  return {
    foreground: {
      ...parsed.foreground,
      hex: parsed.foreground.hex.toUpperCase(),
    },
    background: {
      ...parsed.background,
      hex: parsed.background.hex.toUpperCase(),
    },
  };
}

async function runPixelPickerExeStreaming(params: {
  exePath: string;
  args: string[];
  timeoutMs: number;
  outFilePath: string;
  onProgress?: (progress: Partial<PixelPickResult>) => void;
}): Promise<PixelPickResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(params.exePath, params.args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let resolved = false;

    const finishFromOutFile = async (): Promise<void> => {
      try {
        const fileText = await readFile(params.outFilePath, "utf8");
        const parsed = parsePixelPickerJson(fileText);
        resolved = true;
        resolve(parsed);
      } catch {
        // Fallback: if file read fails, we'll wait for stdout or handle error in close handler
      }
    };

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (!isPartialPixelPickResult(parsed)) {
        return;
      }

      // Normalize hex values to uppercase
      const normalizedProgress: Partial<PixelPickResult> = {
        ...parsed,
        foreground: parsed.foreground
          ? {
              ...parsed.foreground,
              hex: parsed.foreground.hex.toUpperCase(),
            }
          : undefined,
        background: parsed.background
          ? {
              ...parsed.background,
              hex: parsed.background.hex.toUpperCase(),
            }
          : undefined,
      };

      params.onProgress?.(normalizedProgress);

      if (
        normalizedProgress.foreground?.hex &&
        normalizedProgress.background?.hex &&
        isPixelPickResult(normalizedProgress)
      ) {
        resolved = true;
        resolve(normalizedProgress);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");

      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        handleLine(line);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        child.kill();
      }
    }, params.timeoutMs + 5000);

    child.on("close", async (code) => {
      clearTimeout(timeout);

      if (resolved) {
        return;
      }

      await finishFromOutFile();
      if (resolved) {
        return;
      }

      const exitCode = code ?? -1;
      if (exitCode === 2) {
        reject(new Error("PICKER_CANCELED"));
        return;
      }

      if (exitCode === 4) {
        reject(new Error("PICKER_TIMEOUT"));
        return;
      }

      reject(new Error(stderrBuffer.trim() || `Pixel picker failed (exit code ${exitCode}).`));
    });

    child.on("error", reject);
  });
}

function formatPickerFailureMessage(params: { platform: NodeJS.Platform; message: string }): string {
  if (params.platform === "win32") {
    const msg = params.message;
    if (
      msg.includes("You must install or update .NET to run this application.") ||
      msg.includes("The specified framework") ||
      msg.includes("Microsoft.WindowsDesktop.App") ||
      msg.includes("hostfxr.dll")
    ) {
      return "Windows helper requires the .NET Desktop Runtime (x64). Install it, then restart Raycast and try again.";
    }

    return msg;
  }

  if (params.platform !== "darwin") {
    return params.message;
  }

  const msg = params.message;

  if (msg.includes("Missing mac helper")) {
    return "Build the macOS helper: run scripts/build-mac.sh (on a Mac), then try again.";
  }

  if (msg.includes("Accessibility permission") || msg.includes("event tap")) {
    return "Grant Raycast Accessibility permission (System Settings → Privacy & Security → Accessibility), then try again.";
  }

  if (msg.includes("Screen Recording permission") || msg.includes("Screen Recording")) {
    return "Grant Raycast Screen Recording permission (System Settings → Privacy & Security → Screen Recording), then try again.";
  }

  if (msg.includes("PICKER_TIMEOUT")) {
    return "Timed out waiting for two clicks. Run “Pick two pixels”, then click foreground, then background.";
  }

  return msg;
}
