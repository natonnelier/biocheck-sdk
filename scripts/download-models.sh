#!/usr/bin/env bash
# Downloads and copies all model files required by the Biocheck SDK into public/models/.
# Run after `npm install`: bash scripts/download-models.sh
set -euo pipefail

MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/models"
NM="$(cd "$(dirname "$0")/.." && pwd)/node_modules"

echo "Target: $MODELS_DIR"
mkdir -p \
  "$MODELS_DIR" \
  "$MODELS_DIR/mediapipe/wasm" \
  "$MODELS_DIR/tesseract/lang-data"

# ── 1. MediaPipe Face Landmarker task ─────────────────────────────────────────
echo "[1/6] face_landmarker.task"
curl -fL --progress-bar \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" \
  -o "$MODELS_DIR/face_landmarker.task"

# ── 2. SFace INT8 ONNX (OpenCV Zoo) ──────────────────────────────────────────
echo "[2/6] sface_int8.onnx"
curl -fL --progress-bar \
  "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec_int8.onnx" \
  -o "$MODELS_DIR/sface_int8.onnx"

# ── 3. MiniFASNetV2 ONNX ─────────────────────────────────────────────────────
# The official Minivision repo ships PyTorch weights only.
# Export steps (requires Python + PyTorch):
#
#   git clone https://github.com/minivision-ai/Silent-Face-Anti-Spoofing /tmp/fas
#   cd /tmp/fas
#   # Download 2.7_80x80_MiniFASNetV2.pth from the repo's releases
#   python -c "
#   import torch, sys
#   sys.path.insert(0, '.')
#   from src.model_lib.MiniFASNet import MiniFASNetV2
#   m = MiniFASNetV2(conv6_kernel=(5,5)); m.eval()
#   sd = torch.load('resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth', map_location='cpu')
#   m.load_state_dict(sd)
#   dummy = torch.zeros(1, 3, 80, 80)
#   torch.onnx.export(m, dummy, 'minifasnetv2.onnx',
#     input_names=['input'], output_names=['output'],
#     opset_version=11)
#   "
#   cp /tmp/fas/minifasnetv2.onnx "$MODELS_DIR/minifasnetv2.onnx"
#
# Alternatively, place a pre-converted ONNX at:
#   $MODELS_DIR/minifasnetv2.onnx

if [ ! -f "$MODELS_DIR/minifasnetv2.onnx" ]; then
  echo "[3/6] minifasnetv2.onnx — SKIPPED (manual step required, see comments above)"
else
  echo "[3/6] minifasnetv2.onnx — already present"
fi

# ── 4. OCR-B traineddata (Shreeshrii/tessdata_ocrb, Apache 2.0) ───────────────
echo "[4/6] ocrb_int.traineddata"
curl -fL --progress-bar \
  "https://github.com/Shreeshrii/tessdata_ocrb/raw/main/ocrb_int.traineddata" \
  -o "$MODELS_DIR/tesseract/lang-data/ocrb_int.traineddata"

# ── 5. MediaPipe Tasks Vision WASM (from node_modules) ───────────────────────
echo "[5/6] MediaPipe WASM"
MEDIAPIPE_WASM="$NM/@mediapipe/tasks-vision/wasm"
if [ ! -d "$MEDIAPIPE_WASM" ]; then
  echo "  ERROR: $MEDIAPIPE_WASM not found. Run npm install first." >&2
  exit 1
fi
cp "$MEDIAPIPE_WASM"/vision_wasm_internal.js        "$MODELS_DIR/mediapipe/wasm/"
cp "$MEDIAPIPE_WASM"/vision_wasm_internal.wasm      "$MODELS_DIR/mediapipe/wasm/"
cp "$MEDIAPIPE_WASM"/vision_wasm_module_internal.js   "$MODELS_DIR/mediapipe/wasm/"
cp "$MEDIAPIPE_WASM"/vision_wasm_module_internal.wasm "$MODELS_DIR/mediapipe/wasm/"
cp "$MEDIAPIPE_WASM"/vision_wasm_nosimd_internal.js   "$MODELS_DIR/mediapipe/wasm/"
cp "$MEDIAPIPE_WASM"/vision_wasm_nosimd_internal.wasm "$MODELS_DIR/mediapipe/wasm/"

# ── 6. Tesseract.js worker + core WASM (from node_modules) ───────────────────
echo "[6/6] Tesseract.js worker + WASM core"
TESS_DIST="$NM/tesseract.js/dist"
TESS_CORE="$NM/tesseract.js-core"
if [ ! -f "$TESS_DIST/worker.min.js" ] || [ ! -f "$TESS_CORE/tesseract-core.wasm.js" ]; then
  echo "  ERROR: tesseract.js or tesseract.js-core not found in node_modules." >&2
  exit 1
fi
cp "$TESS_DIST/worker.min.js"              "$MODELS_DIR/tesseract/"
cp "$TESS_CORE/tesseract-core.wasm.js"    "$MODELS_DIR/tesseract/"
cp "$TESS_CORE/tesseract-core.wasm"       "$MODELS_DIR/tesseract/"
# SIMD variants for capable browsers
cp "$TESS_CORE/tesseract-core-simd.wasm.js"  "$MODELS_DIR/tesseract/"
cp "$TESS_CORE/tesseract-core-simd.wasm"     "$MODELS_DIR/tesseract/"

echo ""
echo "Done. Files in $MODELS_DIR:"
find "$MODELS_DIR" -type f | sort | sed "s|$MODELS_DIR/||"
if [ ! -f "$MODELS_DIR/minifasnetv2.onnx" ]; then
  echo ""
  echo "⚠  minifasnetv2.onnx is missing — see comments in this script for export steps."
fi
