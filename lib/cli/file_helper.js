/**
 * Helper to stream a fetch Response to a file on disk.
 */

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import {
  parseContentDispositionFilename,
  safeFilename,
  safeJoin,
} from '../../src/safe_filename.js';

/**
 * Stream a `Response` (with a binary body) to a file inside `directory`.
 * Returns the full path to the saved file.
 *
 * @param {Response} rsp
 * @param {string} directory
 * @param {string} [explicitFilename] - if provided, used as the
 *   filename (after `safeFilename` validation).  Otherwise the
 *   filename is taken from the response's `Content-Disposition`
 *   header (also validated).  In either case the resulting path is
 *   verified to stay inside `directory`.
 */
export async function streamToFile(rsp, directory, explicitFilename) {
  let filename;
  if (explicitFilename !== undefined && explicitFilename !== null) {
    filename = safeFilename(String(explicitFilename));
  } else {
    const headerName = parseContentDispositionFilename(rsp.headers.get('content-disposition'));
    filename = headerName ? safeFilename(headerName) : 'mendeley-file';
  }
  const path = safeJoin(directory, filename);
  if (!rsp.body) {
    throw new Error('Response had no body');
  }
  await pipeline(rsp.body, createWriteStream(path));
  return path;
}
