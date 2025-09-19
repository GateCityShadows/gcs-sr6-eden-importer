Gate City Shadows — SR6 Eden Importer

A lightweight Foundry VTT module that imports **shadowrun6-eden** Actor JSON files.

## Install
1. Copy this folder to `Data/modules/gcs-sr6-eden-importer/`.
2. Enable the module in **Game Settings → Manage Modules**.
3. Open the **Actors Directory**. Click **SR6-Eden Import** in the header.

## Usage
- Choose a `.json` file exported by your Gate City Shadows generator or any JSON matching the Eden actor schema.
- (Optional) choose a target Actor folder.
- Click **Import**. The module validates attributes/skills and creates a new Actor.

## JSON expectations
Top-level keys:
- `name` (string)
- `type` (ideally `"Player"`; `"character"` is coerced)
- `img` (optional), `prototypeToken` (optional)
- `system`:
  - `attributes`: `bod/agi/rea/str/wil/log/int/cha` each as `{ base, ... }` (numbers are auto-wrapped).
  - `attributes.mag`, `attributes.res`, `attributes.edg` objects (auto-created if missing).
  - `skills`: eden keys; numbers or expanded objects.

## Compatibility
- `module.json` uses `compatibility.minimum/verified`. Update if you verify on newer Foundry versions.
- Works with Foundry VTT v12–v13. Uses `Actor.implementation.create` if available.  

Copyright 2025 - Gate City Shadows/C Grant
