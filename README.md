# Pets OS downloads

Served at https://downloads.shouldbe.media/ (GitHub Pages).

- `petsos/store/v1/` — the Pets OS O Store: `catalog.txt`, `catalog.sig` (ECDSA P-256, checked
  against the key built into every Pets OS kernel) and `pkg/<id>-<version>.pet`.
- `petsos/mobile/v1/` — O Store for phones (Pets OS for Stephone): `catalog.json`, `catalog.sig` (same key) and
  `pkg/<id>-<version>.js`, built with `tools/make_phone_store.py` in the PetsOS-Mobile repo.
- Built and signed on the owner's Mac with `tools/release/make_store.py`; the private key is
  never in this repository. Package files are never replaced; new versions get new names.
- A catalogue expires after 30 days, so it is re-signed and pushed at least monthly.
