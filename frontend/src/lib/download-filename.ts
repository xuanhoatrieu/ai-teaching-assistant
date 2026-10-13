/**
 * Extract a safe download filename from a Content-Disposition header.
 *
 * - Prefers RFC 5987 `filename*=UTF-8''...` (Vietnamese titles), falls back to `filename="..."`.
 * - Strips stray quotes/whitespace (a malformed header once produced `xxx.xml"` which the
 *   browser saved as `xxx.xml_`, and Moodle refused to import it).
 * - Replaces characters illegal in filenames and enforces the expected extension.
 */
export function filenameFromDisposition(
    disposition: string | undefined | null,
    fallback: string,
    requiredExtension?: string,
): string {
    let name = '';

    if (disposition) {
        const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        const asciiMatch = disposition.match(/filename\s*=\s*("([^"]*)"|[^;]+)/i);
        const raw = utf8Match?.[1] ?? asciiMatch?.[2] ?? asciiMatch?.[1] ?? '';
        try {
            name = decodeURIComponent(raw);
        } catch {
            name = raw;
        }
    }

    name = name
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .trim();

    if (!name) name = fallback;

    if (requiredExtension) {
        const ext = requiredExtension.startsWith('.') ? requiredExtension : `.${requiredExtension}`;
        if (!name.toLowerCase().endsWith(ext.toLowerCase())) {
            // e.g. "abc.xml_" -> "abc.xml" (already correct after trimming junk), "abc" -> "abc.xml"
            const trimmed = name.replace(/[._\s]+$/, '');
            name = trimmed.toLowerCase().endsWith(ext.toLowerCase()) ? trimmed : `${trimmed}${ext}`;
        }
    }
    return name;
}
