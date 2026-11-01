import { parseCampaignLinks } from "./links";

/**
 * Client-side: flatten an uploaded file to text and extract every link found (smart
 * detection handles newlines, commas, spaces AND concatenated URLs). Supports
 * csv / xlsx / xls (SheetJS), docx (mammoth), and plain text — both deps already ship.
 * Business+ automator feature (owner-tier gated at the call site).
 */
export async function extractLinksFromFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  let text = "";

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    text = (await mammoth.extractRawText({ arrayBuffer })).value;
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    for (const sheetName of wb.SheetNames) {
      text += "\n" + XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
    }
  } else {
    // .txt and anything else → raw text.
    text = await file.text();
  }

  return parseCampaignLinks(text);
}
