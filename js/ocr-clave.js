'use strict';

// OCR de la clave de acceso para el módulo móvil "Cargar factura".
// Se usa SOLO cuando la factura no trae código de barras legible; el escáner
// sigue siendo la vía principal. Todo ocurre en el teléfono: Tesseract.js está
// alojado en `vendor/tesseract/` y la foto no se sube a ningún servidor.
//
// Estrategia para impresiones matriciales gastadas:
//  1. Preprocesado fuerte en el navegador: gris, ampliado, desenfoque leve,
//     umbral adaptativo (Sauvola), cierre morfológico para unir los puntos de
//     la matriz y corrección de inclinación.
//  2. Varias combinaciones de binarizado y modo de segmentación (ensemble).
//  3. Dos modelos: `eng` rápido primero y, si no hay lectura fiable, el modelo
//     `engbest` (más preciso, se descarga solo cuando hace falta).
//  4. La validación y reconstrucción de la clave vive en `window.app.accessKey`.
(function () {
  const BASE = 'vendor/tesseract/';
  const MAX_CANVAS_PIXELS = 6_000_000;
  const TARGET_LINE_HEIGHT = 60;

  const workers = new Map(); // lang -> Promise<worker>

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

  function getWorker(lang) {
    if (workers.has(lang)) return workers.get(lang);
    const promise = (async () => {
      await loadScriptOnce(BASE + 'tesseract.min.js');
      const worker = await window.Tesseract.createWorker(lang, 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE,
        langPath: BASE,
        gzip: true
      });
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7',
        classify_bln_numeric_mode: '1',
        load_system_dawg: '0',
        load_freq_dawg: '0',
        user_defined_dpi: '300'
      });
      // Se le dice a Tesseract que espere una cadena de 49 dígitos.
      try {
        await worker.writeText('clave49.patterns', `${'\\d'.repeat(49)}\n`);
        await worker.setParameters({ user_patterns_file: 'clave49.patterns' });
      } catch (_) { /* opcional: si el runtime no lo admite se ignora */ }
      return worker;
    })().catch((error) => {
      workers.delete(lang);
      throw error;
    });
    workers.set(lang, promise);
    return promise;
  }

  async function terminateWorkers() {
    for (const [lang, promise] of workers) {
      workers.delete(lang);
      try { (await promise).terminate(); } catch (_) { /* ya terminado */ }
    }
  }


  // ---- Preprocesado -------------------------------------------------------

  function cropAndScale(source, cropRect) {
    const sw = source.naturalWidth || source.videoWidth || source.width;
    const sh = source.naturalHeight || source.videoHeight || source.height;
    if (!sw || !sh) throw new Error('La imagen no se pudo procesar.');
    const rect = cropRect || { x: 0, y: 0, w: sw, h: sh };
    rect.x = Math.max(0, Math.min(rect.x, sw - 1));
    rect.y = Math.max(0, Math.min(rect.y, sh - 1));
    rect.w = Math.max(1, Math.min(rect.w, sw - rect.x));
    rect.h = Math.max(1, Math.min(rect.h, sh - rect.y));
    let scale = Math.min(5, Math.max(1, TARGET_LINE_HEIGHT / Math.max(12, rect.h / 4)));
    if (rect.w * scale * rect.h * scale > MAX_CANVAS_PIXELS) {
      scale = Math.sqrt(MAX_CANVAS_PIXELS / (rect.w * rect.h));
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.w * scale));
    canvas.height = Math.max(1, Math.round(rect.h * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function toGrayArray(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Float32Array(canvas.width * canvas.height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    return gray;
  }

  function boxBlur3(src, w, h) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += src[yy * w + xx];
            count += 1;
          }
        }
        out[y * w + x] = sum / count;
      }
    }
    return out;
  }

  // Umbral adaptativo de Sauvola con imágenes integrales (O(n)).
  function sauvola(gray, w, h, window, k) {
    const radius = Math.max(2, Math.floor(window / 2));
    const sat = new Float64Array((w + 1) * (h + 1));
    const sqt = new Float64Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y += 1) {
      let rowSum = 0;
      let rowSq = 0;
      for (let x = 1; x <= w; x += 1) {
        const v = gray[(y - 1) * w + (x - 1)];
        rowSum += v;
        rowSq += v * v;
        sat[y * (w + 1) + x] = sat[(y - 1) * (w + 1) + x] + rowSum;
        sqt[y * (w + 1) + x] = sqt[(y - 1) * (w + 1) + x] + rowSq;
      }
    }
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y += 1) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      for (let x = 0; x < w; x += 1) {
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(w - 1, x + radius);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const A = y0 * (w + 1) + x0;
        const B = y0 * (w + 1) + (x1 + 1);
        const C = (y1 + 1) * (w + 1) + x0;
        const D = (y1 + 1) * (w + 1) + (x1 + 1);
        const sum = sat[D] - sat[B] - sat[C] + sat[A];
        const sqSum = sqt[D] - sqt[B] - sqt[C] + sqt[A];
        const mean = sum / area;
        const variance = Math.max(0, sqSum / area - mean * mean);
        const std = Math.sqrt(variance);
        const threshold = mean * (1 + k * (std / 128 - 1));
        out[y * w + x] = gray[y * w + x] < threshold ? 0 : 255;
      }
    }
    return out;
  }

  function otsu(gray, w, h) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i += 1) hist[Math.max(0, Math.min(255, gray[i] | 0))] += 1;
    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t += 1) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let threshold = 127;
    for (let t = 0; t < 256; t += 1) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = t; }
    }
    const out = new Uint8ClampedArray(w * h);
    for (let i = 0; i < gray.length; i += 1) out[i] = gray[i] < threshold ? 0 : 255;
    return out;
  }

  function stretch(gray, w, h) {
    let min = 255;
    let max = 0;
    for (let i = 0; i < gray.length; i += 1) {
      if (gray[i] < min) min = gray[i];
      if (gray[i] > max) max = gray[i];
    }
    const span = Math.max(1, max - min);
    const out = new Uint8ClampedArray(w * h);
    for (let i = 0; i < gray.length; i += 1) {
      const v = ((gray[i] - min) / span) * 255;
      out[i] = v < 90 ? 0 : 255;
    }
    return out;
  }

  // Cierre morfológico (dilatar y erosionar) con kernel en cruz 3x3.
  // Une los puntos de los caracteres matriciales. Trabaja sobre tinta = negro (0).
  function morphClose(bin, w, h) {
    const dil = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let ink = bin[y * w + x] === 0;
        if (!ink) {
          if (x > 0 && bin[y * w + x - 1] === 0) ink = true;
          else if (x < w - 1 && bin[y * w + x + 1] === 0) ink = true;
          else if (y > 0 && bin[(y - 1) * w + x] === 0) ink = true;
          else if (y < h - 1 && bin[(y + 1) * w + x] === 0) ink = true;
        }
        dil[y * w + x] = ink ? 0 : 255;
      }
    }
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let keep = dil[y * w + x] === 0;
        if (keep) {
          if (x > 0 && dil[y * w + x - 1] !== 0) keep = false;
          else if (x < w - 1 && dil[y * w + x + 1] !== 0) keep = false;
          else if (y > 0 && dil[(y - 1) * w + x] !== 0) keep = false;
          else if (y < h - 1 && dil[(y + 1) * w + x] !== 0) keep = false;
        }
        out[y * w + x] = keep ? 0 : 255;
      }
    }
    return out;
  }

  function estimateSkew(bin, w, h) {
    // Perfil de proyección: el ángulo con filas más contrastadas es el correcto.
    let bestAngle = 0;
    let bestScore = -1;
    for (let deg = -6; deg <= 6; deg += 1) {
      const rad = (deg * Math.PI) / 180;
      const tan = Math.tan(rad);
      const rows = new Float64Array(h);
      for (let y = 0; y < h; y += 1) {
        let count = 0;
        for (let x = 0; x < w; x += 1) {
          const yy = Math.round(y + (x - w / 2) * tan);
          if (yy >= 0 && yy < h && bin[yy * w + x] === 0) count += 1;
        }
        rows[y] = count;
      }
      let mean = 0;
      for (let y = 0; y < h; y += 1) mean += rows[y];
      mean /= h;
      let score = 0;
      for (let y = 0; y < h; y += 1) score += (rows[y] - mean) * (rows[y] - mean);
      if (score > bestScore) { bestScore = score; bestAngle = deg; }
    }
    return bestAngle;
  }

  function binToCanvas(bin, w, h, skewDeg) {
    const base = document.createElement('canvas');
    base.width = w;
    base.height = h;
    const bctx = base.getContext('2d');
    const image = bctx.createImageData(w, h);
    for (let i = 0, p = 0; p < bin.length; i += 4, p += 1) {
      image.data[i] = image.data[i + 1] = image.data[i + 2] = bin[p];
      image.data[i + 3] = 255;
    }
    bctx.putImageData(image, 0, 0);
    if (!skewDeg) return base;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, w, h);
    octx.translate(w / 2, h / 2);
    octx.rotate((-skewDeg * Math.PI) / 180);
    octx.drawImage(base, -w / 2, -h / 2);
    return out;
  }

  function buildVariants(source, cropRect) {
    const scaled = cropAndScale(source, cropRect);
    const w = scaled.width;
    const h = scaled.height;
    const gray = toGrayArray(scaled);
    const blurred = boxBlur3(gray, w, h);
    const win = Math.max(15, Math.round(w * 0.04));

    const sauvolaBin = morphClose(sauvola(blurred, w, h, win, 0.34), w, h);
    const skew = estimateSkew(sauvolaBin, w, h);

    return [
      { name: 'sauvola', canvas: binToCanvas(sauvolaBin, w, h, skew) },
      { name: 'otsu', canvas: binToCanvas(morphClose(otsu(blurred, w, h), w, h), w, h) },
      { name: 'stretch', canvas: binToCanvas(stretch(gray, w, h), w, h) }
    ];
  }

  // ---- OCR --------------------------------------------------------------

  async function readText(worker, canvas, pageSegMode) {
    await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  }

  // Lee un renglón y devuelve los dígitos en orden con la confianza de cada uno,
  // para poder votar por posición entre varias lecturas.
  async function readClave(worker, canvas, pageSegMode) {
    await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const digits = [];
    const weights = [];
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node.symbols) && node.symbols.length) {
        for (const sym of node.symbols) {
          const ch = String(sym.text || '').replace(/\D/g, '');
          if (ch.length === 1) { digits.push(ch); weights.push(Number(sym.confidence) || 0); }
        }
        return;
      }
      for (const key of ['blocks', 'paragraphs', 'lines', 'words']) {
        if (Array.isArray(node[key])) node[key].forEach(walk);
      }
    };
    (data.blocks || []).forEach(walk);
    if (!digits.length) {
      const fallback = String(data.text || '').replace(/\D/g, '');
      return { text: data.text || '', digits: fallback, weights: null };
    }
    return { text: data.text || '', digits: digits.join(''), weights };
  }

  function hintsFromText(text) {
    if (window.app?.accessKey?.hintsFromText) return window.app.accessKey.hintsFromText(text);
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

  // Recorre variantes de binarizado y modos de segmentación. Acumula cada
  // lectura (con confianza por dígito) en `reads` y devuelve pronto si una
  // lectura suelta ya valida.
  async function runEnsemble(worker, variants, psmList, hints, reads) {
    for (const variant of variants) {
      for (const psm of psmList) {
        const read = await readClave(worker, variant.canvas, psm);
        reads.push({ digits: read.digits, weights: read.weights });
        const single = window.app.accessKey.resolveFromText(read.text || read.digits, hints);
        if (single && single.confidence === 'alta') return single;
      }
    }
    return null;
  }

  // Ubica el renglón de la clave en la foto completa para colocar el recuadro
  // automáticamente. Devuelve { top, height } como fracción de la altura, o null.
  async function locateClaveLine(source) {
    let worker;
    try { worker = await getWorker('eng'); } catch (_) { return null; }
    let scaled;
    try { scaled = cropAndScale(source, null); } catch (_) { return null; }
    const gray = toGrayArray(scaled);
    const canvas = binToCanvas(stretch(gray, scaled.width, scaled.height), scaled.width, scaled.height, 0);
    let data;
    try {
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6', user_patterns_file: '' });
      ({ data } = await worker.recognize(canvas, {}, { blocks: true }));
    } catch (_) {
      return null;
    } finally {
      try {
        await worker.setParameters({ tessedit_char_whitelist: '0123456789', user_patterns_file: 'clave49.patterns' });
      } catch (_) { /* se restaura al usar */ }
    }
    const lines = [];
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) lines.push({ text: line.text || '', bbox: line.bbox });
      }
    }
    let best = null;
    for (const line of lines) {
      if (!line.bbox) continue;
      const digitCount = line.text.replace(/\D/g, '').length;
      const labelled = /clave|acceso|autoriz/i.test(line.text);
      const score = (labelled ? 400 : 0) + (digitCount >= 40 ? digitCount + 120 : digitCount);
      if (score >= 60 && (!best || score > best.score)) best = { score, bbox: line.bbox };
    }
    if (!best) return null;
    const height = scaled.height;
    const width = scaled.width;
    const pad = Math.max(6, (best.bbox.y1 - best.bbox.y0) * 0.3);
    return {
      top: Math.max(0, (best.bbox.y0 - pad) / height),
      height: Math.min(1, (best.bbox.y1 - best.bbox.y0 + pad * 2) / height),
      left: Math.max(0, best.bbox.x0 / width),
      right: Math.min(1, best.bbox.x1 / width)
    };
  }

  // source: HTMLImageElement | ImageBitmap | HTMLCanvasElement | HTMLVideoElement
  // cropRect: { x, y, w, h } en píxeles del `source` (opcional).
  async function run(source, cropRect, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    let variants;
    try {
      variants = buildVariants(source, cropRect);
    } catch (error) {
      throw new Error('La foto no se pudo procesar. Toma otra con más luz.');
    }
    const fullScaled = cropAndScale(source, null);
    const fullGray = toGrayArray(fullScaled);
    const fullCanvas = binToCanvas(stretch(fullGray, fullScaled.width, fullScaled.height), fullScaled.width, fullScaled.height, 0);

    const reads = [];
    let usedBest = false;
    try {
      onProgress('Analizando la foto…');
      const fastWorker = await getWorker('eng');
      const fullText = `${await readText(fastWorker, fullCanvas, '6')}`;
      const hints = hintsFromText(fullText);

      const fastHit = await runEnsemble(fastWorker, variants, ['7', '13', '6'], hints, reads);
      if (fastHit && fastHit.confidence === 'alta') return fastHit;

      const votedFast = window.app.accessKey.voteFromReads(reads, hints);
      if (votedFast && votedFast.confidence === 'alta') return votedFast;

      onProgress('Afinando la lectura…');
      usedBest = true;
      const bestWorker = await getWorker('engbest');
      const bestFull = `${await readText(bestWorker, fullCanvas, '6')}`;
      const allHints = hintsFromText(`${fullText}\n${bestFull}`);
      const deepHit = await runEnsemble(bestWorker, variants.slice(0, 2), ['7', '13'], allHints, reads);
      if (deepHit && deepHit.confidence === 'alta') return deepHit;

      const voted = window.app.accessKey.voteFromReads(reads, allHints);
      if (voted && voted.confidence === 'alta') return voted;

      const merged = window.app.accessKey.resolveFromText(
        `${reads.map((r) => r.digits).join('\n')}\n${fullText}\n${bestFull}`,
        allHints
      );
      return merged || voted || votedFast || deepHit || fastHit || null;
    } catch (error) {
      await terminateWorkers();
      throw new Error('No se pudo leer la foto. Inténtalo de nuevo con más luz o escríbela.');
    } finally {
      if (usedBest) {
        const promise = workers.get('engbest');
        workers.delete('engbest');
        if (promise) { try { (await promise).terminate(); } catch (_) { /* ya */ } }
      }
    }
  }

  async function warmup() {
    try { await getWorker('eng'); } catch (_) { /* se reintenta al usar */ }
  }

  window.ocrClave = { run, warmup, locateClaveLine };
})();
