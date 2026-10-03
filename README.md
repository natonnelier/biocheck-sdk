# biocheck-sdk

Browser-based biometric identity verification SDK. The full pipeline runs in the user's browser — no biometric data ever leaves the device.

## Pipeline

```
selfie video + document image
  → liveness (active challenges + MiniFASNetV2 passive)
  → OCR (MRZ via Tesseract.js)
  → document photo extraction (Face Landmarker)
  → biometric comparison (SFace INT8 + cosine similarity)
  → { accepted: boolean, score?: number }
```

## Installation

```bash
npm install biocheck-sdk
```

## Usage

```typescript
import { verify, openCameraStream, closeCamera } from "biocheck-sdk";

// 1. Open the front camera
const { stream, video } = await openCameraStream();
document.body.appendChild(video);

// 2. Load the document image
const response = await fetch("/path/to/document.jpg");
const blob = await response.blob();
const documentImage = await createImageBitmap(blob);

// 3. Run the verification pipeline
const result = await verify(video, documentImage, {}, (step) => {
  console.log("Progress:", step);
});

console.log(result.accepted, result.score);

// 4. Clean up
closeCamera(stream);
```

### `verify(videoElement, documentImage, config?, onProgress?)`

| Parameter | Type | Description |
|---|---|---|
| `videoElement` | `HTMLVideoElement` | Live video stream of the user's face |
| `documentImage` | `ImageBitmap` | Front side of the identity document |
| `config` | `BiocheckConfig` | Optional configuration overrides |
| `onProgress` | `(step: ProgressStep) => void` | Called at each pipeline step |

Returns `Promise<VerifyResult>`:

```typescript
interface VerifyResult {
  accepted: boolean;
  score?: number;           // cosine similarity (0–1); present if comparison was reached
  rejectedAt?: "liveness" | "document_ocr" | "document_photo" | "biometric_comparison";
}
```

### Configuration

```typescript
interface BiocheckConfig {
  threshold?: number;                  // face match threshold (default: 0.363)
  modelsBaseUrl?: string;              // where model files are served (default: "/models")
  livenessChallengCount?: number;      // number of active challenges (default: 3)
  livenessChallengeDuration?: number;  // seconds per challenge (default: 5)
  livenessPassiveThreshold?: number;   // MiniFASNetV2 threshold (default: 0.5)
}
```

### Progress steps

`"initializing"` → `"liveness_challenge"` → `"capturing_document"` → `"ocr"` → `"extracting_document_photo"` → `"biometric_comparison"` → `"done"`

## Model files

The SDK loads model files at runtime from `modelsBaseUrl`. Place them in `public/models/` for local development.

| File | Source |
|---|---|
| `face_landmarker.task` | [MediaPipe (Google)](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) |
| `sface_int8.onnx` | [OpenCV Zoo (Apache 2.0)](https://github.com/opencv/opencv_zoo) |
| `minifasnetv2.onnx` | [Minivision (Apache 2.0)](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) |
| `ocrb_int.traineddata` | [Tesseract OCR-B model](https://github.com/Shreeshrii/tessdata_ocrb) |
| `mediapipe/wasm/*` | MediaPipe WASM assets |
| `tesseract/*` | Tesseract.js worker + WASM |

## Dependencies

| Library | Purpose |
|---|---|
| `@mediapipe/tasks-vision` | Face detection, landmarks, blendshapes |
| `onnxruntime-web` | SFace INT8 + MiniFASNetV2 inference |
| `tesseract.js` | MRZ OCR |
| `mrz` | MRZ parsing and checksum validation |

Inference uses the WebAssembly backend by default. SIMD and multithreading are enabled automatically when the page is served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers.

## Development

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm test           # Vitest unit tests
npm run typecheck  # TypeScript check
npm run build      # produces dist/
```

## Privacy

All processing happens locally in the browser. The SDK does not transmit biometric data, embeddings, or document images to any server. The `verify()` return value contains only a boolean and a similarity score.

## License

[MIT](LICENSE)
