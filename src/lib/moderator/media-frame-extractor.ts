import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

/* =========================================================
   Bounded video frame extraction — the ONLY place this feature touches a
   temporary file on disk, and only for video (photos are classified
   directly from the downloaded buffer, in memory, per the "prefer
   in-memory processing" requirement).

   Uses ffmpeg-static (added as a new dependency — no ffmpeg binary or
   equivalent existed anywhere in this codebase/deployment before this).
   Requires live verification on Vercel's Linux build/runtime before
   enabling in production — gated behind its own server-only
   MEDIA_MODERATION_VIDEO_ENABLED flag (see plan.ts), OFF by default,
   independent of the photo-moderation flag, so photo moderation can ship
   without waiting on that verification.

   Every temp file uses a random, non-user-controlled name inside a
   per-request temp directory, and is removed in a try/finally covering
   both the success and failure paths — never left on disk, per the "do not
   leave pornographic user media on disk indefinitely" requirement.
   ========================================================= */

const FFMPEG_TIMEOUT_MS = 20_000;

export interface FrameExtractionResult {
  ok: true;
  frames: Buffer[];
}
export interface FrameExtractionFailure {
  ok: false;
  reason: "ffmpeg_unavailable" | "decode_failed" | "timeout";
}

/** Extracts one JPEG frame per requested millisecond-offset position.
 *  Positions beyond the actual video duration are simply skipped (ffmpeg
 *  returns nothing for them) rather than failing the whole extraction. */
export async function extractVideoFrames(videoBuffer: Buffer, positionsMs: number[]): Promise<FrameExtractionResult | FrameExtractionFailure> {
  if (!ffmpegPath) return { ok: false, reason: "ffmpeg_unavailable" };

  const dir = await mkdtemp(join(tmpdir(), "innvil-media-"));
  const inputPath = join(dir, `${randomUUID()}.mp4`);
  try {
    await writeFile(inputPath, videoBuffer);

    const frames: Buffer[] = [];
    for (const posMs of positionsMs) {
      const outputPath = join(dir, `${randomUUID()}.jpg`);
      try {
        await execFileAsync(
          ffmpegPath,
          ["-ss", (posMs / 1000).toFixed(3), "-i", inputPath, "-frames:v", "1", "-q:v", "3", "-y", outputPath],
          { timeout: FFMPEG_TIMEOUT_MS }
        );
        const frame = await readFile(outputPath);
        frames.push(frame);
      } catch {
        // This specific position failed (past end-of-stream, unsupported
        // codec at that offset, etc.) -- skip it, don't fail the whole
        // extraction over one bad sample point.
      } finally {
        await rm(outputPath, { force: true }).catch(() => {});
      }
    }

    if (frames.length === 0) return { ok: false, reason: "decode_failed" };
    return { ok: true, frames };
  } catch {
    return { ok: false, reason: "decode_failed" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
