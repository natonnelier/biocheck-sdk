import type { Challenge, FrameHint } from "../protocol.js";

/** User-facing text (Spanish, Argentina). */
export const S = {
  preparing: "Preparando la verificación…",
  chooseDocument: "¿Con qué documento te vas a verificar?",
  dni: "DNI",
  passport: "Pasaporte",
  openingCamera: "Abriendo la cámara…",
  takePhoto: "Tomar foto",
  uploadFile: "Subir archivo",
  mrzPrompt: {
    dni: "Encuadrá el dorso del DNI dentro del marco",
    passport: "Encuadrá la página de datos del pasaporte dentro del marco",
  },
  photoPromptDni: "Ahora encuadrá el frente del DNI dentro del marco",
  photoPromptPassport: "Encuadrá otra vez la página de datos del pasaporte",
  readingMrz: "Leyendo el documento…",
  analysingPhoto: "Analizando la fotografía del documento…",
  mrzRetry: (attempt: number, max: number) =>
    `No se pudo leer la zona inferior del documento. Probá con más luz y sin reflejos (intento ${attempt} de ${max}).`,
  photoRetry: (attempt: number, max: number) =>
    `No se encontró la foto del titular con suficiente resolución. Acercá el documento (intento ${attempt} de ${max}).`,
  waitingFaceModels: "Cargando los modelos faciales…",
  lookAtCamera: "Ubicá tu rostro frente a la cámara",
  challengeProgress: (i: number, n: number) => `Desafío ${i} de ${n}`,
  processing: "Procesando…",
};

export function challengeText(c: Challenge): string {
  switch (c.kind) {
    case "blink":
      return "Parpadeá";
    case "turn":
      return c.side === "left"
        ? "Girá la cabeza hacia tu izquierda y volvé al centro"
        : "Girá la cabeza hacia tu derecha y volvé al centro";
    case "move_closer":
      return "Acercate a la cámara";
  }
}

export function hintText(h: FrameHint): string {
  switch (h) {
    case "no_face":
      return "No se detecta ningún rostro";
    case "multiple_faces":
      return "Hay más de un rostro en la imagen";
    case "face_too_small":
      return "Acercate un poco más a la cámara";
  }
}
