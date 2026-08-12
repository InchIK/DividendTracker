/**
 * Constant-time token comparison using SHA-256.
 *
 * Comparing raw strings with `===` leaks length via early-exit timing.
 * Instead, hash both inputs with SHA-256 and compare the resulting
 * fixed-width byte arrays in constant time.
 *
 * Returns true iff the two tokens produce identical SHA-256 digests.
 */

/** XOR-check a pair of equal-length Uint8Array buffers in constant time. */
function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** SHA-256 hash a string, returning the digest as a Uint8Array. */
async function sha256Bytes(input: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

/**
 * Compare two string tokens in constant time by hashing each and
 * comparing the digests. Safe to use with secrets of unequal length.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  // Run both hashes, then constant-time compare the 32-byte digests.
  const [hashA, hashB] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);
  return constantTimeBytesEqual(hashA, hashB);
}