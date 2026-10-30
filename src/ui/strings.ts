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
    dni: "Encuadrá el dorso del DNI (el lado con las tres líneas con <<<) dentro del marco",
    passport: "Encuadrá la página de datos del pasaporte (la de tu foto) dentro del marco",
  },
  photoPromptDni: "Ahora encuadrá el frente del DNI (el lado con tu foto) dentro del marco",
  photoPromptPassport: "Encuadrá otra vez la página de datos del pasaporte",
  readingMrz: "Leyendo el documento…",
  analysingPhoto: "Analizando la fotografía del documento…",
  attempt: (attempt: number, max: number) => `Intento ${attempt} de ${max}`,
  waitingFaceModels: "Cargando los modelos faciales…",
  lookAtCamera: "Ubicá tu rostro frente a la cámara",
  challengeProgress: (i: number, n: number) => `Desafío ${i} de ${n}`,
  processing: "Procesando…",

  // Step-transition screens (View.notice).
  continue: "Continuar",
  retry: "Reintentar",
  start: "Comenzar",
  finish: "Finalizar",
  mrzOkDni: {
    title: "¡Dorso del DNI validado!",
    body: "Ahora sacale una foto al frente del DNI, el lado donde está tu foto.",
  },
  mrzFailed: {
    title: "No pudimos leer el documento",
    body: {
      dni: "Encuadrá el dorso del DNI de modo que las tres líneas con <<< del pie se vean completas y nítidas, con buena luz y sin reflejos.",
      passport:
        "Encuadrá la página de datos de modo que las dos líneas con <<< del pie se vean completas y nítidas, con buena luz y sin reflejos.",
    },
  },
  photoFailed: {
    title: "No encontramos tu foto en el documento",
    body: "Acercá el documento para que tu foto se vea grande y nítida, sin reflejos.",
  },
  documentOk: {
    title: { dni: "¡DNI validado!", passport: "¡Pasaporte validado!" },
    body: "Ahora vamos a hacer la verificación en vivo con la cámara frontal.",
  },
  livenessIntro: {
    title: "Verificación en vivo",
    body: (challenges: number, seconds: number) =>
      `Te vamos a pedir ${challenges === 1 ? "una de estas acciones" : challenges === 3 ? "estas tres acciones" : `${challenges} de estas acciones`}, de a una y en orden al azar. Tenés ${seconds} segundos para cada una:`,
    items: [
      "Parpadear",
      "Girar la cabeza hacia un costado y volver al centro",
      "Acercarte a la cámara",
    ],
    tips: "Ubicate frente a la cámara sin otras personas en la imagen, con buena luz y sin gorra ni anteojos de sol.",
  },
  // Final screens. A rejection after the face phase does not say which check
  // failed (liveness, passive score or comparison): the worker reports only
  // the decision, and a reason would help an attacker.
  result: {
    accepted: {
      title: "¡Identidad verificada!",
      body: "Completaste la verificación correctamente.",
    },
    rejected: {
      title: "No pudimos verificar tu identidad",
      body: "No pudimos confirmar que seas la persona titular del documento.",
    },
    documentRejected: {
      title: "No pudimos validar el documento",
      body: "Se agotaron los intentos para leer el documento.",
    },
  },
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
