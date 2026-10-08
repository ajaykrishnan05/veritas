import { ApiError } from '../http-error.ts';

export interface ValidatedUpload {
  ext: 'pdf' | 'png' | 'jpg';
  mime: 'application/pdf' | 'image/png' | 'image/jpeg';
}

const EXT_MAP: Record<string, ValidatedUpload> = {
  pdf: { ext: 'pdf', mime: 'application/pdf' },
  png: { ext: 'png', mime: 'image/png' },
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
};

/** Validates declared MIME, extension, size, emptiness and magic bytes (corrupt/mislabeled files). */
export function validateUpload(file: { originalname: string; mimetype: string; buffer: Buffer }, maxBytes: number): ValidatedUpload {
  const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
  const spec = EXT_MAP[extension];
  if (!spec) throw new ApiError(415, 'invalid_file_type', 'Unsupported file type. Upload a PDF, PNG, JPG or JPEG.');
  if (file.mimetype !== spec.mime) throw new ApiError(415, 'invalid_file_type', `File extension .${extension} does not match its declared type (${file.mimetype}).`);
  if (file.buffer.length === 0) throw new ApiError(400, 'empty_file', 'The file is empty.');
  if (file.buffer.length > maxBytes) throw new ApiError(413, 'file_too_large', `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);

  const b = file.buffer;
  const corrupt = () => new ApiError(400, 'corrupt_file', 'The file appears to be corrupt or is not a valid document of the declared type.');
  if (spec.ext === 'pdf') {
    if (b.subarray(0, 5).toString('latin1') !== '%PDF-' || !b.subarray(Math.max(0, b.length - 2048)).toString('latin1').includes('%%EOF')) throw corrupt();
  } else if (spec.ext === 'png') {
    if (!b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw corrupt();
  } else if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) {
    throw corrupt();
  }
  return spec;
}
