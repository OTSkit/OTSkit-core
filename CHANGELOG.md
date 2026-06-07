## [0.1.5](https://github.com/OTSkit/OTSkit-core/compare/v0.1.4...v0.1.5) (2026-06-07)


### Bug Fixes

* add parseCalendarUri with HTTPS enforcement and allowlist (L1) ([f87673c](https://github.com/OTSkit/OTSkit-core/commit/f87673ca11a8697cdd5a706ac7c78ed562ab25ed))
* add strict mode to readVaruint to reject non-canonical overlong encodings ([8f48a68](https://github.com/OTSkit/OTSkit-core/commit/8f48a6862ffc9f783e009ec6d69245f12e49f2f4))
* add verifyAgainstRawHeader with explicit Bitcoin internal byte order (M4) ([5fb8e44](https://github.com/OTSkit/OTSkit-core/commit/5fb8e446608e7bdadee5a4cf5b7596fde70fb789))
* add verifyBitcoinAttestation to prevent backdating attack (M1) ([2476b57](https://github.com/OTSkit/OTSkit-core/commit/2476b577d43bc6eb29e2e660e9dd31354442d24a))
* block SHA-1/RIPEMD-160 in DetachedTimestampFile creation (M3) ([2cf05d6](https://github.com/OTSkit/OTSkit-core/commit/2cf05d6af22cc27c0d93b29cc1433cfaa221416e))
* make Timestamp.attestations immutable, add addAttestation() with validation (L2) ([73e5c23](https://github.com/OTSkit/OTSkit-core/commit/73e5c23cf9597c53b95643a597564b039c0f2f18)), closes [#attestations](https://github.com/OTSkit/OTSkit-core/issues/attestations)
* regenerate package-lock.json to match package.json version 0.1.4 ([c333f6d](https://github.com/OTSkit/OTSkit-core/commit/c333f6db21561130986814ee0a543633510d24e8))
* separate presence check from cryptographic verification (M2) ([7d5d44f](https://github.com/OTSkit/OTSkit-core/commit/7d5d44f1b37e4ed81d09ac45a52ac39b1aea7013))

## [0.1.4](https://github.com/OTSkit/OTSkit-core/compare/v0.1.3...v0.1.4) (2026-06-05)


### Bug Fixes

* add repository and homepage fields to package.json ([97a5761](https://github.com/OTSkit/OTSkit-core/commit/97a57613eb218f577d908195d6ad126c49c03461))

## [0.1.3](https://github.com/OTSkit/OTSkit-core/compare/v0.1.2...v0.1.3) (2026-06-05)


### Bug Fixes

* run build before semantic-release so dist/ is included in npm publish ([99e27ea](https://github.com/OTSkit/OTSkit-core/commit/99e27ead5bdd860350d254cfd300488666a14ce2))

## [0.1.2](https://github.com/OTSkit/OTSkit-core/compare/v0.1.1...v0.1.2) (2026-06-05)


### Bug Fixes

* add missing license field to package.json ([72bc735](https://github.com/OTSkit/OTSkit-core/commit/72bc7355a7ed68bf661f4430855fd5121b55df6d))
