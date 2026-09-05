'use strict';

// OCR de la clave de acceso para el módulo móvil "Cargar factura".
// Se usa SOLO cuando la factura no trae código de barras legible; el escáner
// sigue siendo la vía principal. Todo ocurre en el teléfono: Tesseract.js está
// alojado en `vendor/tesseract/` y la foto nunca se sube a ningún servidor.
// La reconstrucción y validación de la clave vive en `window.app.accessKey`.
(function () {
  const BASE = 'vendor/tesseract/';
  let workerPromise = null;

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve();
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('No se pudo cargar el lector de texto.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar el lector de texto.'));
      document.body.appendChild(script);
    });
  }

  function getWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      await loadScriptOnce(BASE + 'tesseract.min.js');
      const worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE,
        langPath: BASE,
        gzip: true
      });
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789 -',
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1'
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
    return workerPromise;
  }

  // Recorta la banda elegida, pasa a gris, amplía y estira el contraste.
  const MAX_CANVAS_PIXELS = 6_000_000; // techo para no reiniciar la pestaña en móviles

  function preprocess(source, cropRect) {
    const sw = source.naturalWidth || source.videoWidth || source.width;
    const sh = source.naturalHeight || source.videoHeight || source.height;
    if (!sw || !sh) throw new Error('La imagen no se pudo procesar.');
    const rect = cropRect || { x: 0, y: 0, w: sw, h: sh };
    rect.w = Math.max(1, Math.min(rect.w, sw - rect.x));
    rect.h = Math.max(1, Math.min(rect.h, sh - rect.y));
    const targetHeight = 340;
    let scale = Math.min(4, Math.max(1, targetHeight / Math.max(1, rect.h)));
    if (rect.w * scale * rect.h * scale > MAX_CANVAS_PIXELS) {
      scale = Math.sqrt(MAX_CANVAS_PIXELS / (rect.w * rect.h));
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.w * scale));
    canvas.height = Math.max(1, Math.round(rect.h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      const gray = (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114) | 0;
      data[index] = data[index + 1] = data[index + 2] = gray;
      if (gray < min) min = gray;
      if (gray > max) max = gray;
    }
    const span = Math.max(1, max - min);
    for (let index = 0; index < data.length; index += 4) {
      let value = ((data[index] - min) / span) * 255;
      value = value < 0 ? 0 : value > 255 ? 255 : value;
      data[index] = data[index + 1] = data[index + 2] = value;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  async function readText(worker, canvas, pageSegMode) {
    if (pageSegMode) await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  }

  function hintsFromText(text) {
    const hints = {};
    const factura = String(text || '').match(/(\d{3})\s*-\s*(\d{3})\s*-\s*(\d{6,9})/);
    if (factura) {
      hints.serie = factura[1] + factura[2];
      hints.secuencial = factura[3].padStart(9, '0').slice(-9);
    }
    const ruc = String(text || '').match(/\b(\d{13})\b/);
    if (ruc) hints.ruc = ruc[1];
    return hints;
  }

  // source: HTMLImageElement | ImageBitmap | HTMLCanvasElement | HTMLVideoElement
  // cropRect: { x, y, w, h } en píxeles del `source` (opcional).
  async function run(source, cropRect) {
    let worker;
    try {
      worker = await getWorker();
    } catch (error) {
      throw new Error('No se pudo iniciar el lector de texto. Revisa tu conexión e inténtalo de nuevo.');
    }
    try {
      // 1) La banda recortada como línea única: el caso normal y más rápido.
      const bandLine = await readText(worker, preprocess(source, cropRect), '7');
      let hit = window.app.accessKey.resolveFromText(bandLine, {});
      if (hit && hit.confidence === 'alta') return hit;

      // 2) La foto completa: aporta la línea de AUTORIZACIÓN (misma clave) y el
      //    RUC / número de factura para contrastar y corregir un dígito mal leído.
      const fullText = await readText(worker, preprocess(source, null), '6');
      const hints = hintsFromText(fullText);
      return window.app.accessKey.resolveFromText(`${bandLine}\n${fullText}`, hints) || hit;
    } catch (error) {
      // Si el worker se cayó, se descarta para que el siguiente intento lo recree.
      try { await worker.terminate(); } catch (_) { /* ya terminado */ }
      workerPromise = null;
      throw new Error('No se pudo leer la foto. Inténtalo de nuevo con más luz o escríbela.');
    }
  }

  window.ocrClave = { run, warmup: getWorker };
})();
