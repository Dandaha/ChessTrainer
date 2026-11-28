/**
 * A text file's contents, read as UTF-8 or, when it is not valid UTF-8, as Windows-1252 (Latin-1):
 * older PGN files often are, and read as UTF-8 their names turn to "Szab�".
 */
export async function readTextFile(file: Blob): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
