/**
 * Turn a pasted video link (YouTube, Vimeo, or a direct file URL) into something
 * renderable. Used by the public landing walkthrough slot and the super-admin
 * preview. Pure + client-safe.
 */
export type VideoEmbed =
  | { kind: "none" }
  | { kind: "file"; src: string }
  | { kind: "iframe"; src: string };

const FILE_EXT = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;

export function toVideoEmbed(rawUrl: string | null | undefined): VideoEmbed {
  const url = (rawUrl ?? "").trim();
  if (!url) return { kind: "none" };

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "none" };
  }
  const host = u.host.toLowerCase().replace(/^www\./, "");

  // YouTube — watch?v=, youtu.be/<id>, /embed/<id>, /shorts/<id>
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2] ?? "";
    else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2] ?? "";
    else id = u.searchParams.get("v") ?? "";
    id = id.split("/")[0];
    if (id) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}` };
  }

  // Vimeo — vimeo.com/<id> or player.vimeo.com/video/<id>
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const id = parts[parts.length - 1];
    if (id && /^\d+$/.test(id)) return { kind: "iframe", src: `https://player.vimeo.com/video/${id}` };
  }

  // Direct video file.
  if (FILE_EXT.test(u.pathname)) return { kind: "file", src: url };

  // Anything else: try to embed as-is (self-hosted players, etc.).
  return { kind: "iframe", src: url };
}
