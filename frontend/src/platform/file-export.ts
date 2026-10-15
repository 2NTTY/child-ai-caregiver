export async function exportBlob(blob: Blob, filename: string, isCurrent: () => boolean = () => true): Promise<string> {
  if (!isCurrent()) throw new Error("Export scope changed");
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  try { link.href = url; link.download = filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
  return "已交給瀏覽器下載，請核對下載結果。";
}
export async function exportText(text: string, filename: string, isCurrent: () => boolean = () => true): Promise<void> {
  await exportBlob(new Blob([text], { type: "application/json;charset=utf-8" }), filename, isCurrent);
}
