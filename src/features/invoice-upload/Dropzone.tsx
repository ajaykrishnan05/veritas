import { useRef, useState, type DragEvent } from 'react';

export const ACCEPT = ['application/pdf', 'image/png', 'image/jpeg'];
const EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'];
export const MAX_MB = 10;

/** Client-side pre-check for fast feedback; the server re-validates everything. */
export function checkFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!EXTENSIONS.includes(ext) || !ACCEPT.includes(file.type)) return 'Invalid file. Upload a PDF, PNG, JPG or JPEG.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_MB * 1024 * 1024) return `This file is larger than ${MAX_MB} MB.`;
  return null;
}

export default function Dropzone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f && !disabled) onFile(f);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`rounded-lg border-2 border-dashed p-10 text-center transition-colors ${over ? 'border-primary bg-indigo-50' : 'border-slate-300 bg-white'} ${disabled ? 'opacity-60' : ''}`}
    >
      <p className="text-base font-semibold">Drag and drop an invoice here</p>
      <p className="mt-1 text-sm text-slate-600">PDF, PNG, JPG or JPEG, up to {MAX_MB} MB</p>
      <button type="button" className="btn-secondary mt-4" disabled={disabled} onClick={() => input.current?.click()}>Choose a file</button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label="Invoice file"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        disabled={disabled}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
    </div>
  );
}
