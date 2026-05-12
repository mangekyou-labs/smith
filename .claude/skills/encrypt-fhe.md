# Encrypt FHE Skill

Use this skill when working on Encrypt FHE (Fully Homomorphic Encryption) integration for Solana confidential computations.

## Protocol

**Encrypt** by dWallet Labs — smart contracts compute on encrypted data without decrypting on-chain.
- Docs: `https://docs.encrypt.xyz/`
- GitHub: `dwallet-labs/encrypt-pre-alpha`

## Key Facts

| Item | Value |
|---|---|
| Solana program ID (devnet) | `Cq37zHSH1zB6xomYK2LjP6uXJvLR3uTehxA5W9wgHGvx` |
| gRPC endpoint | `pre-alpha-dev-1.encrypt.ika-network.net:443` |
| TypeScript SDK | `@encrypt.xyz/pre-alpha-solana-client` |
| Rust toolchain | 1.94, edition 2024 |

**Pre-alpha status:** Encryption is **mocked**. All data stored publicly on-chain as plaintext. Real FHE (REFHE) planned for production.

## Core Concepts

### FHE Types

**Scalar types:**
- `EBool`, `EUint8`, `EUint16`, `EUint32`, `EUint64`, `EUint128`, `EUint256`, `EUint512`, `EUint1024`, `EUint65536`
- `EAddress`

**Boolean vectors:** `EBitVector2`..`EBitVector65536`

**Arithmetic vectors:** `EVectorU8`..`EVectorU32768` (SIMD-style, 8,192 bytes each)

**Plaintext counterparts:** `PBool`, `PUint8`, `PUint16`, `PUint32`, `PUint64`, etc.

### Graph Computation

`#[encrypt_fn]` macro (in `encrypt-dsl` crate) compiles Rust functions into FHE computation graphs (binary DAG):

```
[8B header] [N×9B nodes] [constants blob]
```

Header: version + per-kind node counts + constants length
Nodes: 9 bytes each (kind, op_type, fhe_type, input_a, input_b, input_c)

`#[encrypt_fn_graph]` generates graph bytes only (no CPI extension).

### FHE Operations

- Arithmetic: `Add`, `Multiply`, `Negate`, `Subtract`, `Divide`, `Modulo`
- Bitwise: `And`, `Or`, `Xor`, `Not`, `ShiftLeft`, `ShiftRight`
- Comparison: `IsLessThan`, `IsEqual`, `IsGreaterOrEqual`, etc.
- Conditional: `Select`, `SelectScalar`

### CPI SDKs (4 variants)

| SDK | Crate | Use case |
|---|---|---|
| Pinocchio | `encrypt-pinocchio` | Maximum CU efficiency, `#![no_std]` |
| Anchor | `encrypt-anchor` | Anchor IDL integration |
| Native | `encrypt-native` | `solana-program` users |
| Quasar | `encrypt-quasar` | Smallest binaries, zero-copy |

All implement same `EncryptCpi` trait. CPI authority seed: `b"__encrypt_cpi_authority"`.

### Encrypt Program Instructions

| Disc | Instruction |
|---|---|
| 0 | `INITIALIZE` |
| 1 | `CREATE_INPUT_CIPHERTEXT` |
| 2 | `CREATE_PLAINTEXT_CIPHERTEXT` |
| 3 | `COMMIT_CIPHERTEXT` |
| 4 | `EXECUTE_GRAPH` |
| 9 | `CLOSE_CIPHERTEXT` |
| 11 | `REQUEST_DECRYPTION` |
| 12 | `RESPOND_DECRYPTION` |
| 14 | `CREATE_DEPOSIT` |
| 22 | `REGISTER_NETWORK_ENCRYPTION_KEY` |

## Account PDAs

| Account | PDA seeds |
|---|---|
| EncryptConfig | `["encrypt_config"]` |
| Authority | `["authority", pubkey]` |
| DecryptionRequest | (keypair, not PDA) |
| EncryptDeposit | `["encrypt_deposit", owner]` |
| RegisteredGraph | `["registered_graph", graph_hash]` |
| Ciphertext | (keypair, not PDA) |
| NetworkEncryptionKey | `["network_encryption_key", key_bytes]` |

## Workflow

1. Write FHE function with `#[encrypt_fn]` macro
2. Macro generates computation graph (graph bytes)
3. On-chain `execute_graph` creates ciphertext accounts + emits event
4. Off-chain executor evaluates graph (real FHE in production, mock in pre-alpha)
5. `request_decryption` → decryptor responds with plaintext

## Key Files in `encrypt-pre-alpha/`

| File | Purpose |
|---|---|
| `crates/encrypt-dsl/macros/src/lib.rs` | `#[encrypt_fn]` proc macro |
| `crates/encrypt-compute/src/mock_crypto.rs` | MockEncryptor + MockVerifier (keccak256-based) |
| `chains/solana/dev/src/tx_builder.rs` | EncryptTxBuilder for building instructions |
| `chains/solana/clients/rust/src/grpc.rs` | Rust gRPC client |
| `chains/solana/clients/typescript/src/grpc.ts` | TypeScript gRPC client |
| `chains/solana/test/src/encrypt_test_context.rs` | LiteSVM test harness |

## TypeScript Client

```typescript
import { encryptClient } from '@encrypt.xyz/pre-alpha-solana-client';
```

## Rust gRPC Client

```rust
use encrypt_grpc::client::EncryptClient;
let client = EncryptClient::<MockEncryptor>::connect(
    "pre-alpha-dev-1.encrypt.ika-network.net:443"
).await?;
let input = client.create_input::<Uint64>(42, &user.pubkey()).await?;
```

## Testing

- **LiteSVM** (`EncryptTestContext`): fast in-process e2e tests
- **Mollusk-SVM**: single-instruction unit tests with pre-built account data

```rust
let mut ctx = EncryptTestContext::new_default();
let user = ctx.new_funded_keypair();
let a = ctx.create_input::<Uint64>(10, &user.pubkey());
let outputs = ctx.execute_and_commit(&graph, &[a], 1, &[], &user);
let result = ctx.decrypt::<Uint64>(&outputs[0], &user);
```
