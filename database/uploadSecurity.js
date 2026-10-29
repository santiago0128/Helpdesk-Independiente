import fs from "node:fs/promises";
import path from "node:path";

const blockedExtensions = new Set([".ade", ".adp", ".apk", ".app", ".bat", ".cmd", ".com", ".cpl", ".dll", ".exe", ".hta", ".htm", ".html", ".jar", ".js", ".jse", ".msi", ".php", ".ps1", ".py", ".scr", ".sh", ".svg", ".vbs", ".wsf"]);
const allowedDocumentExtensions = new Set([".doc", ".docx", ".pdf", ".txt", ".xls", ".xlsx", ".zip"]);
const allowedMime = (mime = "") => /^(image|video|audio)\//i.test(mime) || ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "text/plain"].includes(mime);

export const isAllowedUpload = (file) => {
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  return !blockedExtensions.has(extension) && (allowedMime(file.mimetype) || allowedDocumentExtensions.has(extension));
};

const invalid = (message, code = "INVALID_UPLOAD") => Object.assign(new Error(message), { status: 415, code });

export const validateUploadedFiles = async (files = []) => {
  for (const file of files) {
    if (!isAllowedUpload(file)) throw invalid(`Tipo de archivo no permitido: ${file.originalname}`);
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    if ([".pdf", ".zip", ".docx", ".xlsx"].includes(extension)) {
      const header = await fs.readFile(file.path, { encoding: null }).then((buffer) => buffer.subarray(0, 8));
      const isPdf = extension === ".pdf" && header.toString("ascii", 0, 4) === "%PDF";
      const isZip = [".zip", ".docx", ".xlsx"].includes(extension) && header[0] === 0x50 && header[1] === 0x4b;
      if (!isPdf && !isZip) throw invalid(`El contenido de ${file.originalname} no coincide con su extensión`);
    }
  }
};
