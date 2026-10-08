// Minimal, dependency-free single-page PDF writer (Helvetica text only). Text streams are left
// uncompressed so the embedded demo marker is readable by the deterministic fallback extractor.
const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '-').replace(/([\\()])/g, '\\$1');

export function buildPdf(lines: Array<{ text: string; size?: number; bold?: boolean; x?: number }>, marker: string): Buffer {
  let y = 800;
  let content = '';
  for (const l of lines) {
    const size = l.size ?? 11;
    content += `BT /${l.bold ? 'F2' : 'F1'} ${size} Tf ${l.x ?? 50} ${y} Td (${esc(l.text)}) Tj ET\n`;
    y -= size + 7;
  }
  content += `BT /F1 6 Tf 50 30 Td (${esc(marker)}) Tj ET\n`;

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Title (Synthetic demo invoice) /Keywords (${esc(marker)}) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
