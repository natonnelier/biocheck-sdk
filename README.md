# biocheck-sdk

Browser-based biometric identity verification SDK. The full pipeline runs in the user's browser — no biometric data ever leaves the device.

## Pipeline

```
document phase: MRZ image → crop + gray + upscale + Otsu → Tesseract.js (OCR-B) → mrz check digits
                photo image → Face Landmarker (IMAGE) → largest face ≥ 112 px → 5-point align → SFace embedding
face phase:     camera frames → Face Landmarker (VIDEO) → liveness state machine (blink / turn / move closer)
                → MiniFASNetV2 on 3 frames → most frontal frame → SFace → max(0, cos) ≥ τ
                → { accepted: boolean, score?: number }
```

## Usage

```typescript
import { verify, BiocheckError } from "biocheck-sdk";

try {
  const { accepted, score } = await verify(document.getElementById("kyc")!, {
    modelsBaseUrl: "/models",
  });
} catch (e) {
  if (e instanceof BiocheckError) console.error(e.code);
}
```

The SDK draws its own UI inside the container (camera view, document guide
frame, capture/upload buttons, challenge prompts and hints) and opens and stops
the camera itself.

### `verify(container, config?)`

Resolves with `{ accepted: boolean; score?: number }`. `score` (0–1) is present
only when the biometric comparison was reached. Embeddings, images and
document data are never returned.

Rejects with a `BiocheckError` whose `code` is one of `browser_not_supported`,
`camera_permission_denied`, `camera_unavailable`, `model_load_failed`,
`invalid_config` or `internal_error`. These are failures to complete the
verification, not decisions.

### Configuration

Every parameter of thesis table 3.6, grouped by module; anything omitted takes
its default (`DEFAULT_CONFIG`). Changing only `decision.threshold` is
recommended — relaxing liveness parameters weakens attack resistance.

```typescript
verify(container, {
  modelsBaseUrl: "/models",
  camera:     { minWidth: 640, minHeight: 480, minFrameRate: 15 },
  detection:  { minConfidence: 0.8, minFaceWidthRatio: 0.25 },
  liveness:   { challengeCount: 3, timeoutSeconds: 5,
                blinkClosedThreshold: 0.5, blinkOpenThreshold: 0.3, blinkClosedFrames: 2,
                turnDegrees: 20, returnDegrees: 10,
                widthIncrease: 0.3, perspectiveIncrease: 0.05,
                passiveFrames: 3, passiveThreshold: 0.5 },
  document:   { mrzCharHeightMin: 30, mrzCharHeightMax: 40, photoMinWidth: 112, maxCaptures: 3 },
  comparison: { maxAngleDegrees: 15 },
  decision:   { threshold: 0.363 },
});
```

## Model files

All models and WASM runtimes are served from the application's own origin —
never from a CDN. `models.manifest.json` pins each file's version, size and
SHA-256. The build (and the dev server) expose them as
`<modelsBaseUrl>/<sha256[:16]>/<file>` plus a `manifest.json` that the SDK reads
at startup, so every file can be cached as immutable.

```bash
npm run download-models   # fills public/models/ and checks the manifest
npm run models:check      # verify size + SHA-256 of every file
npm run models:pin        # record size + SHA-256 after an intentional update
```

`minifasnetv2.onnx` requires a manual PyTorch → ONNX export; see
[Running locally](#running-locally), step 3.

## Architecture

| Context | Runs |
|---|---|
| Main thread | UI, camera capture, orchestrator, MRZ strip preprocessing, MRZ parsing |
| Face worker (module) | Face Landmarker, MiniFASNetV2, SFace, liveness state machine, decision |
| Tesseract.js worker | OCR (Tesseract.js's own worker, terminated once the MRZ is valid) |

The face worker protocol (`src/protocol.ts`) never sends images, landmarks,
matrices or embeddings to the main thread. Terminating the worker at the end
discards all biometric data at once.

ONNX Runtime Web uses WASM + SIMD; multithreading when the page is
cross-origin isolated (`COOP: same-origin`, `COEP: require-corp`). WebGPU is
used only if a warm-up shows it is faster on the device. MediaPipe tries its
GPU delegate and falls back to CPU.

## Running locally

### Prerequisites

- Node.js 20 or later, and npm.
- A desktop browser released in the last couple of years (Chrome, Firefox or
  Safari) and a webcam.
- Python 3 with PyTorch, only for the one-time MiniFASNetV2 export (step 3).

### 1. Install dependencies

```bash
npm install
```

### 2. Download the models and runtimes

```bash
npm run download-models
```

This fills `public/models/` (about 60 MB, not committed). It downloads Face
Landmarker, SFace and OCR-B, and copies the MediaPipe, ONNX Runtime and
Tesseract.js runtime files out of `node_modules`. When it finishes, it checks
every file against `models.manifest.json`. On a first run, `minifasnetv2.onnx`
shows as `MISSING` until you complete step 3.

### 3. Export MiniFASNetV2 to ONNX (one time)

Minivision publishes only PyTorch weights, so the passive liveness model needs
a manual conversion:

```bash
git clone https://github.com/minivision-ai/Silent-Face-Anti-Spoofing /tmp/fas
cd /tmp/fas
python3 -m venv .venv && . .venv/bin/activate
pip install torch onnx
python - <<'EOF'
import sys, torch
sys.path.insert(0, ".")
from src.model_lib.MiniFASNet import MiniFASNetV2
m = MiniFASNetV2(conv6_kernel=(5, 5)); m.eval()
sd = torch.load("resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth", map_location="cpu")
m.load_state_dict({k.replace("module.", "", 1): v for k, v in sd.items()})
torch.onnx.export(m, torch.zeros(1, 3, 80, 80), "minifasnetv2.onnx",
                  input_names=["input"], output_names=["output"], opset_version=11)
EOF
cp minifasnetv2.onnx <path-to-biocheck-sdk>/public/models/
cd <path-to-biocheck-sdk>
npm run models:pin      # records its size and SHA-256 in models.manifest.json
npm run models:check    # every line should now say OK
```

Without this file, `verify` rejects with `model_load_failed` once the document
step is done.

### 4. Start the demo

```bash
npm run dev
```

The dev server opens <http://localhost:5173/demo/>. Click **Verificar
identidad**, then:

1. Choose **DNI** or **Pasaporte**.
2. Photograph the back of the DNI (or the passport data page) inside the
   frame, or upload an image of it with **Subir archivo**.
3. For a DNI, photograph or upload the front.
4. Follow the on-screen challenges (blink, turn your head, move closer).

The demo prints the result (`Verificado` / `Rechazado` and the score) or the
error code.

The dev server sends the `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` headers, so the page is cross-origin isolated
and ONNX Runtime runs multithreaded. You can check this in the console with
`crossOriginIsolated`, which should be `true`.

### Testing on a phone

Browsers grant camera access only on `https://` or `localhost`, so opening
`http://<your-ip>:5173` from a phone won't work. Serve the dev server over
HTTPS, for example through a tunnel that forwards the COOP/COEP headers, or by
adding `@vitejs/plugin-basic-ssl` and running `npx vite --host`.

### Other commands

```bash
npm test                # unit tests (Vitest)
npm run typecheck       # tsc --noEmit
npm run build           # library in dist/, models in dist/models/<hash>/
npm run models:check    # verify every model file against the manifest
```

### Troubleshooting

| Symptom | Cause |
|---|---|
| `Error: model_load_failed` | A model file is missing or its download failed. Run `npm run models:check`. |
| `Error: camera_permission_denied` | Camera access was blocked. Allow it in the site settings and retry. |
| `Error: camera_unavailable` | No camera was found, it is in use by another app, or it can't deliver 640 x 480 at 15 fps. |
| `Error: browser_not_supported` | The browser lacks a required API: `requestVideoFrameCallback`, module workers or WebAssembly SIMD. |
| `models:check` reports `MISMATCH` | A file changed after it was pinned. Re-download it, or run `npm run models:pin` if the update was intentional. |

## Privacy

All processing happens locally. The SDK persists nothing (no localStorage or
IndexedDB; Tesseract.js's IndexedDB cache is disabled) and the only network
traffic is the download of the static model files.

## License

[MIT](LICENSE)
