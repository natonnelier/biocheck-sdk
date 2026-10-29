#!/usr/bin/env bash
# Downloads and copies every model and WASM runtime file required by the
# Biocheck SDK into public/models/. Run after `npm install`.
#
# Everything is served from the application's own origin (thesis 3.4.1): no
# file is ever loaded from a CDN at runtime. After downloading, the script
# checks each file against models.manifest.json (version, size, SHA-256).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$ROOT/public/models"
NM="$ROOT/node_modules"

echo "Target: $MODELS_DIR"
mkdir -p "$MODELS_DIR/mediapipe" "$MODELS_DIR/ort" "$MODELS_DIR/tesseract"

# ── 1. MediaPipe Face Landmarker task (float16) ──────────────────────────────
echo "[1/7] face_landmarker.task"
curl -fL --progress-bar \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  -o "$MODELS_DIR/face_landmarker.task"

# ── 2. SFace INT8 ONNX (OpenCV Zoo, Apache 2.0) ──────────────────────────────
echo "[2/7] sface_int8.onnx"
curl -fL --progress-bar \
  "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec_int8.onnx" \
  -o "$MODELS_DIR/sface_int8.onnx"

# ── 3. MiniFASNetV2 ONNX ─────────────────────────────────────────────────────
# The official Minivision repo ships PyTorch weights only.
# Export steps (requires Python + PyTorch):
#
#   git clone https://github.com/minivision-ai/Silent-Face-Anti-Spoofing /tmp/fas
#   cd /tmp/fas
#   python -c "
#   import torch, sys
#   sys.path.insert(0, '.')
#   from src.model_lib.MiniFASNet import MiniFASNetV2
#   m = MiniFASNetV2(conv6_kernel=(5,5)); m.eval()
#   sd = torch.load('resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth', map_location='cpu')
#   sd = {k.replace('module.', '', 1): v for k, v in sd.items()}
#   m.load_state_dict(sd)
#   dummy = torch.zeros(1, 3, 80, 80)
#   torch.onnx.export(m, dummy, 'minifasnetv2.onnx',
#     input_names=['input'], output_names=['output'],
#     opset_version=11)
#   "
#   cp /tmp/fas/minifasnetv2.onnx "$MODELS_DIR/minifasnetv2.onnx"
#
# The model expects BGR, 0–255 (no /255: Minivision's to_tensor skips it),
# NCHW 1×3×80×80, crop = 2.7× the face box. Output: 3 logits, real = index 1.
if [ ! -f "$MODELS_DIR/minifasnetv2.onnx" ]; then
  echo "[3/7] minifasnetv2.onnx — SKIPPED (manual step required, see comments above)"
else
  echo "[3/7] minifasnetv2.onnx — already present"
fi

# ── 4. OCR-B traineddata (Shreeshrii/tessdata_ocrb, Apache 2.0) ───────────────
echo "[4/7] ocrb_int.traineddata"
curl -fL --progress-bar \
  "https://github.com/Shreeshrii/tessdata_ocrb/raw/master/ocrb_int.traineddata" \
  -o "$MODELS_DIR/tesseract/ocrb_int.traineddata"

# ── 5. MediaPipe Tasks Vision WASM (SIMD, ES-module build for a module worker) 
echo "[5/7] MediaPipe WASM"
MEDIAPIPE_WASM="$NM/@mediapipe/tasks-vision/wasm"
if [ ! -d "$MEDIAPIPE_WASM" ]; then
  echo "  ERROR: $MEDIAPIPE_WASM not found. Run npm install first." >&2
  exit 1
fi
cp "$MEDIAPIPE_WASM/vision_wasm_module_internal.js"   "$MODELS_DIR/mediapipe/"
cp "$MEDIAPIPE_WASM/vision_wasm_module_internal.wasm" "$MODELS_DIR/mediapipe/"

# ── 6. ONNX Runtime Web WASM (JSEP build: WASM + WebGPU EPs) ─────────────────
echo "[6/7] ONNX Runtime Web WASM"
ORT_DIST="$NM/onnxruntime-web/dist"
cp "$ORT_DIST/ort-wasm-simd-threaded.jsep.mjs"  "$MODELS_DIR/ort/"
cp "$ORT_DIST/ort-wasm-simd-threaded.jsep.wasm" "$MODELS_DIR/ort/"

# ── 7. Tesseract.js worker + LSTM-only SIMD core (from node_modules) ─────────
echo "[7/7] Tesseract.js worker + core"
TESS_DIST="$NM/tesseract.js/dist"
TESS_CORE="$NM/tesseract.js-core"
if [ ! -f "$TESS_DIST/worker.min.js" ] || [ ! -f "$TESS_CORE/tesseract-core-simd-lstm.wasm.js" ]; then
  echo "  ERROR: tesseract.js or tesseract.js-core not found in node_modules." >&2
  exit 1
fi
cp "$TESS_DIST/worker.min.js"                   "$MODELS_DIR/tesseract/"
cp "$TESS_CORE/tesseract-core-simd-lstm.wasm.js" "$MODELS_DIR/tesseract/"

echo ""
node "$ROOT/scripts/models-manifest.mjs" --check
