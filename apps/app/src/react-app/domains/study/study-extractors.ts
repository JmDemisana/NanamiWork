// Extractors for Study sources: PDF, YouTube, Google Drive, and Webpages.

export function parseYouTubeUrl(url: string): string | null {
  const regExp = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;
  const match = url.trim().match(regExp);
  return match ? match[1] : null;
}

export async function extractYouTubeSource(url: string): Promise<{ name: string; text: string; videoId: string }> {
  const videoId = parseYouTubeUrl(url);
  if (!videoId) throw new Error("Invalid YouTube link. Please use a standard youtube.com or youtu.be URL.");

  let title = `YouTube Video (${videoId})`;
  let author = "";
  try {
    const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    if (oembedRes.ok) {
      const data = await oembedRes.json();
      if (data.title) title = data.title;
      if (data.author_name) author = data.author_name;
    }
  } catch {}

  let transcript = "";
  try {
    const captionRes = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`);
    if (captionRes.ok) {
      const xmlText = await captionRes.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const textNodes = xmlDoc.querySelectorAll("text");
      const lines: string[] = [];
      textNodes.forEach((node) => {
        const line = node.textContent?.replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
        if (line) lines.push(line);
      });
      if (lines.length > 0) {
        transcript = lines.join(" ");
      }
    }
  } catch {}

  const fullText = transcript
    ? `Title: ${title}\nAuthor: ${author}\nURL: https://www.youtube.com/watch?v=${videoId}\n\n--- Video Transcript ---\n${transcript}`
    : `Title: ${title}\nAuthor: ${author}\nURL: https://www.youtube.com/watch?v=${videoId}\n\n[YouTube Video Metadata]\nTitle: ${title}\nCreator: ${author}\nDirect Link: https://www.youtube.com/watch?v=${videoId}\n\n(Captions could not be extracted directly from this video. You can paste notes or transcript excerpts into this source.)`;

  return { name: title, text: fullText, videoId };
}

export function parseGoogleDriveUrl(url: string): { type: "doc" | "sheet" | "drive"; id: string } | null {
  const docMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch) return { type: "doc", id: docMatch[1] };
  const sheetMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetMatch) return { type: "sheet", id: sheetMatch[1] };
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) return { type: "drive", id: driveMatch[1] };
  return null;
}

export async function extractGoogleDriveSource(url: string): Promise<{ name: string; text: string }> {
  const parsed = parseGoogleDriveUrl(url);
  if (!parsed) throw new Error("Invalid Google Drive or Docs link.");

  if (parsed.type === "doc") {
    const exportUrl = `https://docs.google.com/document/d/${parsed.id}/export?format=txt`;
    const res = await fetch(exportUrl);
    if (!res.ok) {
      throw new Error("Could not export Google Doc. Ensure the document link sharing is set to 'Anyone with the link can view'.");
    }
    const text = await res.text();
    if (!text.trim()) throw new Error("The Google Doc is empty.");
    return { name: `Google Doc (${parsed.id.slice(0, 8)})`, text };
  }

  if (parsed.type === "sheet") {
    const exportUrl = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv`;
    const res = await fetch(exportUrl);
    if (!res.ok) {
      throw new Error("Could not export Google Sheet. Ensure the sheet sharing is set to 'Anyone with the link can view'.");
    }
    const text = await res.text();
    return { name: `Google Sheet (${parsed.id.slice(0, 8)})`, text };
  }

  throw new Error("For Google Drive files, share the file as Google Doc or download and upload the file directly.");
}

export async function extractWebSource(url: string): Promise<{ name: string; text: string }> {
  let targetUrl = url.trim();
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = "https://" + targetUrl;
  }
  const res = await fetch(targetUrl);
  if (!res.ok) throw new Error(`Could not fetch webpage (HTTP ${res.status}).`);
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const removeTags = ["script", "style", "nav", "header", "footer", "aside", "svg", "iframe", "noscript"];
  removeTags.forEach((tag) => {
    doc.querySelectorAll(tag).forEach((el) => el.remove());
  });

  const title = doc.querySelector("title")?.textContent?.trim() || doc.querySelector("meta[property='og:title']")?.getAttribute("content") || targetUrl;
  const main = doc.querySelector("article") || doc.querySelector("main") || doc.body;
  const text = (main?.textContent || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();

  if (!text) throw new Error("No readable text found on this webpage.");

  return { name: title, text: `Source URL: ${targetUrl}\n\n${text}` };
}

export async function extractPdfText(file: Blob): Promise<{ text: string; pageCount: number }> {
  const buffer = await file.arrayBuffer();

  // Try dynamic CDN PDF.js
  try {
    // @ts-ignore
    const pdfjs = await import(/* @vite-ignore */ "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
    if (pdfjs && pdfjs.getDocument) {
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
      const numPages = doc.numPages;
      const pages: string[] = [];
      for (let i = 1; i <= numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (pageText) pages.push(`--- Page ${i} ---\n${pageText}`);
      }
      if (pages.length > 0) {
        return { text: pages.join("\n\n"), pageCount: numPages };
      }
    }
  } catch (cdnErr) {
    console.warn("CDN PDF.js load error, using binary fallback extractor:", cdnErr);
  }

  // Fallback: Binary PDF stream & text extractor
  return extractPdfTextFallback(buffer);
}

function extractPdfTextFallback(buffer: ArrayBuffer): { text: string; pageCount: number } {
  const bytes = new Uint8Array(buffer);
  const raw = new TextDecoder("latin1").decode(bytes);

  const pageMatches = raw.match(/\/Type\s*\/Page[^s]/g);
  const pageCount = pageMatches ? pageMatches.length : 1;

  const textBlocks: string[] = [];
  const btRegex = /BT[\s\S]*?ET/g;
  let match: RegExpExecArray | null;

  while ((match = btRegex.exec(raw)) !== null) {
    const block = match[0];
    const strRegex = /\((?:[^()\\]|\\.)*\)|<[0-9a-fA-F]+>/g;
    let strMatch: RegExpExecArray | null;
    const blockParts: string[] = [];
    while ((strMatch = strRegex.exec(block)) !== null) {
      const s = strMatch[0];
      if (s.startsWith("(") && s.endsWith(")")) {
        const clean = s.slice(1, -1)
          .replace(/\\([()\\])/g, "$1")
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .trim();
        if (clean.length > 1) blockParts.push(clean);
      } else if (s.startsWith("<") && s.endsWith(">")) {
        const hex = s.slice(1, -1);
        let decoded = "";
        for (let i = 0; i < hex.length; i += 2) {
          const code = parseInt(hex.substring(i, i + 2), 16);
          if (code >= 32 && code <= 126) decoded += String.fromCharCode(code);
        }
        if (decoded.trim().length > 1) blockParts.push(decoded.trim());
      }
    }
    if (blockParts.length > 0) {
      textBlocks.push(blockParts.join(" "));
    }
  }

  const text = textBlocks.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text: text || "PDF document attached. (Text layer could not be read; the file is preserved in internal storage.)",
    pageCount: Math.max(1, pageCount),
  };
}
