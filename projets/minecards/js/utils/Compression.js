/**
 * Compression - Deflate and Base64 helpers used by the `.save` container.
 *
 * Reference: `.docs/steps/6.md` point 1 and `.docs/main.md` section 3.G.
 *
 * The `.save` file is NOT encrypted: the JSON payload is deflated with
 * `CompressionStream('deflate')` and encoded in Base64. It is only meant to be unreadable at a
 * glance and much smaller than the raw JSON; anyone can decode it (`DecompressionStream` is a
 * browser API). Do not store anything secret in a save.
 *
 * Base64 is produced chunk by chunk: `String.fromCharCode(...bytes)` passes every byte as an
 * argument and throws a `RangeError` (call stack overflow) on a collection large enough to make
 * the file a few megabytes.
 *
 * This module is deliberately dependency-free and has no application logic: it only converts
 * bytes, so it can be reused by any future export format.
 */

/** Number of bytes encoded per `String.fromCharCode` call (32 KiB). */
export const BASE64_CHUNK_SIZE = 0x8000;

/** MIME type of a `.save` file. */
export const SAVE_MIME_TYPE = 'application/octet-stream';

/**
 * Largest payload {@link inflate} accepts, in bytes (32 MiB).
 *
 * A save of a complete account (every card, every binder, the whole history) stays far below one
 * megabyte, and a binder share code is a few kilobytes: the limit only exists to stop a deliberately
 * crafted deflate stream (a "zip bomb" pasted as a binder code, or a hostile `.save`) from expanding
 * until the tab runs out of memory. It is measured on the OUTPUT, which is the only length a
 * compressed payload cannot lie about.
 */
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;

/**
 * Raised when a deflate stream inflates past {@link MAX_INFLATED_BYTES}.
 *
 * A class of its own because the two failures of an inflate are not the same thing at all: a damaged
 * stream is a corrupted file, a stream that blows the limit is a payload the application refuses to
 * load. `decompressJson` keeps the second one as it is instead of reporting it as a broken file.
 */
export class PayloadTooLargeError extends Error {}


/**
 * Checks that the runtime exposes the Compression Streams API.
 *
 * Chrome 80+, Edge 80+, Safari 16.4+ and Firefox 113+ implement it. `CompressionStream` and
 * `DecompressionStream` are shipped together, so checking one of them is enough.
 *
 * @returns {boolean} True when deflate/inflate are usable.
 */
export function isCompressionSupported() {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/**
 * Converts a binary payload into a `Uint8Array` view.
 *
 * @param {ArrayBuffer|ArrayBufferView|Uint8Array} value - Bytes to normalize.
 * @returns {Uint8Array} A `Uint8Array` over the same bytes.
 * @throws {TypeError} When the value is neither an `ArrayBuffer` nor a view.
 */
export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(
    `Compression.toBytes expects an ArrayBuffer or a typed array (received: ${Object.prototype.toString.call(value)}).`
  );
}

/**
 * Deflates a binary payload with `CompressionStream('deflate')` (zlib wrapper included).
 *
 * @param {ArrayBuffer|ArrayBufferView|Uint8Array} value - Bytes to compress.
 * @returns {Promise<Uint8Array>} The deflated bytes.
 * @throws {TypeError} When the value is not binary.
 * @throws {Error} When the Compression Streams API is unavailable or the stream fails.
 */
export async function deflate(value) {
  assertCompressionSupport();
  const bytes = toBytes(value);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Inflates a deflated binary payload with `DecompressionStream('deflate')`.
 *
 * The output is read chunk by chunk rather than in one `arrayBuffer()` call, so the total length can
 * be checked as it grows: a payload that inflates past {@link MAX_INFLATED_BYTES} is abandoned
 * (and its stream cancelled) instead of being allowed to fill the memory of the tab.
 *
 * @param {ArrayBuffer|ArrayBufferView|Uint8Array} value - Deflated bytes.
 * @param {object} [options] - Inflate options.
 * @param {number} [options.maxBytes=MAX_INFLATED_BYTES] - Largest accepted output (0 disables the limit).
 * @returns {Promise<Uint8Array>} The original bytes.
 * @throws {TypeError} When the value is not binary.
 * @throws {Error} When the Compression Streams API is unavailable, or when the payload is not a
 *   valid deflate stream.
 * @throws {PayloadTooLargeError} When the payload inflates past `maxBytes`.
 */
export async function inflate(value, { maxBytes = MAX_INFLATED_BYTES } = {}) {
  assertCompressionSupport();
  const bytes = toBytes(value);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();

  const chunks = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      total += chunk.byteLength;
      if (maxBytes > 0 && total > maxBytes) {
        // Stopping the reader is what actually frees the decompressor: without it the stream would
        // keep expanding in the background, which is exactly what the limit is there to prevent.
        await reader.cancel();
        throw new PayloadTooLargeError(`The payload inflates past the ${maxBytes} byte limit.`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return output;
}

/**
 * Encodes bytes in Base64, in chunks.
 *
 * @param {ArrayBuffer|ArrayBufferView|Uint8Array} value - Bytes to encode.
 * @returns {string} The Base64 representation (no line breaks).
 * @throws {TypeError} When the value is not binary.
 * @throws {Error} When `btoa` is unavailable (non-browser runtime).
 */
export function bytesToBase64(value) {
  if (typeof btoa !== 'function') {
    throw new Error('Compression.bytesToBase64 requires the browser `btoa` function.');
  }

  const bytes = toBytes(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + BASE64_CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string into bytes.
 *
 * Whitespace and line breaks are ignored, so a save that travelled through a text editor or an
 * email still imports. A trailing newline is the common case: `File.text()` preserves it.
 *
 * @param {string} base64 - Base64 text.
 * @returns {Uint8Array} The decoded bytes.
 * @throws {TypeError} When the argument is not a string.
 * @throws {Error} When the text is not valid Base64, or when `atob` is unavailable.
 */
export function base64ToBytes(base64) {
  if (typeof base64 !== 'string') {
    throw new TypeError(`Compression.base64ToBytes expects a string (received: ${typeof base64}).`);
  }
  if (typeof atob !== 'function') {
    throw new Error('Compression.base64ToBytes requires the browser `atob` function.');
  }

  const compact = base64.replace(/\s+/g, '');
  let binary;
  try {
    binary = atob(compact);
  } catch (error) {
    throw new Error('The payload is not valid Base64.', { cause: error });
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Serializes a value to JSON, deflates it and encodes the result in Base64.
 *
 * @param {unknown} value - Structured-cloneable value to serialize (a save payload).
 * @param {object} [options] - Serialization options.
 * @param {boolean} [options.pretty=false] - Indent the intermediate JSON (useful for debugging;
 *   deflate absorbs the extra bytes).
 * @returns {Promise<string>} The Base64 encoded deflate stream.
 * @throws {Error} When the value cannot be serialized, when the Compression Streams API is
 *   unavailable, or when Base64 encoding fails (e.g. a circular structure).
 */
export async function compressJson(value, { pretty = false } = {}) {
  let json;
  try {
    json = JSON.stringify(value, null, pretty ? 2 : 0);
  } catch (error) {
    throw new Error('The payload cannot be serialized to JSON.', { cause: error });
  }
  if (typeof json !== 'string') {
    throw new TypeError('Compression.compressJson received a value that JSON cannot represent.');
  }

  const encoded = new TextEncoder().encode(json);
  return bytesToBase64(await deflate(encoded));
}

/**
 * Decodes Base64, inflates the bytes and parses the JSON.
 *
 * @param {string} base64 - Base64 encoded deflate stream.
 * @returns {Promise<unknown>} The deserialized value (never validated here: see `SaveFile`).
 * @throws {TypeError} When the argument is not a string.
 * @throws {Error} When the Base64, the deflate stream or the JSON is invalid.
 * @throws {PayloadTooLargeError} When the payload inflates past {@link MAX_INFLATED_BYTES}.
 */
export async function decompressJson(base64) {
  const bytes = base64ToBytes(base64);

  let inflated;
  try {
    inflated = await inflate(bytes);
  } catch (error) {
    // Refusing a payload that is too large is not the same failure as a damaged one: the caller
    // (the save import) is free to tell the player which of the two happened.
    if (error instanceof PayloadTooLargeError) throw error;
    throw new Error('The payload is not a valid deflate stream.', { cause: error });
  }

  let json;
  try {
    json = new TextDecoder().decode(inflated);
  } catch (error) {
    throw new Error('The payload is not valid UTF-8 text.', { cause: error });
  }

  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error('The payload is not valid JSON.', { cause: error });
  }
}

/**
 * Throws when the Compression Streams API is missing.
 *
 * @returns {void}
 * @throws {Error} When `CompressionStream`/`DecompressionStream` are unavailable.
 */
function assertCompressionSupport() {
  if (!isCompressionSupported()) {
    throw new Error(
      'The Compression Streams API is unavailable in this browser: the .save format cannot be read or written.'
    );
  }
}
