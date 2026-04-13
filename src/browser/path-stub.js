/**
 * Browser stub for Node.js 'path' module (POSIX-style paths).
 * Provides the most-used path utilities using forward-slash separators,
 * which is sufficient for the code paths exercised in the browser bundle.
 */
export const sep = '/';
export const delimiter = ':';

export const join = (...parts) =>
  parts.filter(p => p != null && p !== '').join('/').replace(/\/+/g, '/');

export const resolve = (...parts) => join(...parts);

export const dirname = (p) => {
  const segments = String(p || '').split('/');
  segments.pop();
  return segments.join('/') || '.';
};

export const basename = (p, ext) => {
  let b = String(p || '').split('/').pop() || '';
  if (ext && b.endsWith(ext)) b = b.slice(0, b.length - ext.length);
  return b;
};

export const extname = (p) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
};

export const normalize = (p) => String(p || '').replace(/\/+/g, '/');

export const relative = () => '';

export const isAbsolute = (p) => String(p || '').startsWith('/');

const path = {
  sep, delimiter, join, resolve, dirname, basename, extname,
  normalize, relative, isAbsolute,
};
export default path;
