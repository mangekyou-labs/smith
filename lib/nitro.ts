/**
 * lib/nitro.ts
 *
 * Client for AWS Nitro Enclave TEE agent inference.
 * Calls the enclave HTTP endpoint which runs Gemini inside Nitro,
 * returns { response, attestation_document, hash }.
 *
 * The attestation_document is a base64-encoded Nitro attestation doc
 * containing PCR0/PCR1 measurements + certificate chain.
 * Verified on-chain in smith_oracle via verify_attestation instruction.
 */

export interface NitroAttestation {
  response: string;
  /** base64-encoded Nitro attestation document (CBOR) */
  attestation_document: string;
  /** sha256 of the Gemini response text */
  hash: string;
}

export async function callNitroAgent(prompt: string): Promise<NitroAttestation> {
  const endpoint = process.env.NITRO_ENCLAVE_ENDPOINT;
  if (!endpoint) throw new Error("NITRO_ENCLAVE_ENDPOINT not set");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: "gemini" }),
  });
  if (!res.ok) {
    throw new Error(`Nitro enclave error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<NitroAttestation>;
}

/** Extract YES/NO vote from Gemini response text */
export function extractVote(text: string): "YES" | "NO" {
  const match = text.match(/My vote:\s*(YES|NO)/i);
  return match?.[1].toUpperCase() === "NO" ? "NO" : "YES";
}

/** sha256 hex of a string — matches enclave-side computation */
export async function hashResponse(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}