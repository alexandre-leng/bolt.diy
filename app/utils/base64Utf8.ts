/** UTF-8 safe base64 helpers, usable in the browser, in workerd and in Node. */
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);

  let binary = '';

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

export function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}
