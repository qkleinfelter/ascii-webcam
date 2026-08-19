(() => {
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const output = document.getElementById('ascii-output');
  const stage = document.querySelector('.stage');
  const statusEl = document.getElementById('status');

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const flipBtn = document.getElementById('flipBtn');
  const resSlider = document.getElementById('resSlider');
  const resValue = document.getElementById('resValue');
  const colorToggle = document.getElementById('colorToggle');
  const invertToggle = document.getElementById('invertToggle');
  const charsetInput = document.getElementById('charsetInput');
  const charsetResetBtn = document.getElementById('charsetResetBtn');
  const captureBtn = document.getElementById('captureBtn');
  const polaroidBoard = document.getElementById('polaroidBoard');
  const pinboardEmpty = document.getElementById('pinboardEmpty');

  // Darkest to lightest; index chosen by luminance.
  const DEFAULT_ASCII_RAMP = '@%#*+=-:. ';
  const CELL_ASPECT = 0.5; // width/height of one ascii "cell" (cols x rows) to mimic a CRT grid
  const GLYPH_WIDTH_RATIO = 0.6; // monospace advance width as a fraction of font-size
  const MONO_COLOR = '214,245,214'; // matches --text, used for polaroid captures in monochrome mode

  let stream = null;
  let rafId = null;
  let facingMode = 'user';
  let cols = Number(resSlider.value);
  let asciiRamp = DEFAULT_ASCII_RAMP;
  let lastFrame = null;

  charsetInput.value = DEFAULT_ASCII_RAMP;

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Camera access is not supported in this browser.');
      return;
    }

    try {
      setStatus('Requesting camera access…');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      startBtn.disabled = true;
      stopBtn.disabled = false;
      flipBtn.disabled = false;
      captureBtn.disabled = false;
      setStatus('Camera active.');
      renderLoop();
    } catch (err) {
      console.error(err);
      setStatus(`Could not access camera: ${err.message}`);
    }
  }

  function stopCamera() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
    output.textContent = '';
    lastFrame = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    flipBtn.disabled = true;
    captureBtn.disabled = true;
    setStatus('Camera stopped.');
  }

  async function flipCamera() {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
      } catch (err) {
        console.error(err);
        setStatus(`Could not switch camera: ${err.message}`);
      }
    }
  }

  function frameToAscii() {
    if (!video.videoWidth || !video.videoHeight) return;

    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    if (!stageWidth || !stageHeight) return;

    const stageAspect = stageWidth / stageHeight;
    const rows = Math.max(1, Math.round((cols * CELL_ASPECT) / stageAspect));

    canvas.width = cols;
    canvas.height = rows;

    // Cover-crop the video so the screen fills without stretching.
    const videoAspect = video.videoWidth / video.videoHeight;
    let sx = 0;
    let sy = 0;
    let sWidth = video.videoWidth;
    let sHeight = video.videoHeight;
    if (videoAspect > stageAspect) {
      sWidth = video.videoHeight * stageAspect;
      sx = (video.videoWidth - sWidth) / 2;
    } else {
      sHeight = video.videoWidth / stageAspect;
      sy = (video.videoHeight - sHeight) / 2;
    }
    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, cols, rows);

    // Size the grid in CSS px so it exactly fills the fixed screen area.
    const cellWidth = stageWidth / cols;
    const cellHeight = stageHeight / rows;
    output.style.fontSize = `${cellWidth / GLYPH_WIDTH_RATIO}px`;
    output.style.lineHeight = `${cellHeight}px`;

    const { data } = ctx.getImageData(0, 0, cols, rows);
    const useColor = colorToggle.checked;
    const invert = invertToggle.checked;
    const COLOR_STEP = 32; // quantize color so runs of pixels can share one <span>

    const frameChars = [];
    const frameColors = useColor ? [] : null;

    let html = '';
    for (let y = 0; y < rows; y++) {
      let runColor = null;
      let runChars = '';
      const rowChars = [];
      const rowColors = useColor ? [] : null;

      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        let luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (invert) luminance = 1 - luminance;

        const rampIndex = Math.min(
          asciiRamp.length - 1,
          Math.floor((1 - luminance) * asciiRamp.length)
        );
        const rawChar = asciiRamp[rampIndex];
        const char = rawChar === ' ' ? '&nbsp;' : rawChar;
        rowChars.push(rawChar);

        if (useColor) {
          const qr = Math.round(r / COLOR_STEP) * COLOR_STEP;
          const qg = Math.round(g / COLOR_STEP) * COLOR_STEP;
          const qb = Math.round(b / COLOR_STEP) * COLOR_STEP;
          const color = `${qr},${qg},${qb}`;
          rowColors.push(color);

          if (color !== runColor) {
            if (runColor !== null) {
              html += `<span style="color:rgb(${runColor})">${runChars}</span>`;
            }
            runColor = color;
            runChars = char;
          } else {
            runChars += char;
          }
        } else {
          html += char;
        }
      }

      if (useColor && runColor !== null) {
        html += `<span style="color:rgb(${runColor})">${runChars}</span>`;
      }
      html += '\n';

      frameChars.push(rowChars);
      if (useColor) frameColors.push(rowColors);
    }
    output.innerHTML = html;
    lastFrame = { cols, rows, chars: frameChars, colors: frameColors, useColor };
  }

  function capturePolaroid() {
    if (!lastFrame) {
      setStatus('Nothing to capture yet.');
      return;
    }

    const { cols: fCols, rows: fRows, chars, colors, useColor } = lastFrame;
    const shotWidth = 320;
    const shotHeight = Math.round((shotWidth * stage.clientHeight) / stage.clientWidth) || 240;

    const shotCanvas = document.createElement('canvas');
    shotCanvas.width = shotWidth;
    shotCanvas.height = shotHeight;
    const shotCtx = shotCanvas.getContext('2d');

    shotCtx.fillStyle = '#010401';
    shotCtx.fillRect(0, 0, shotWidth, shotHeight);

    const cellWidth = shotWidth / fCols;
    const cellHeight = shotHeight / fRows;
    shotCtx.font = `${cellWidth / GLYPH_WIDTH_RATIO}px Consolas, "Courier New", monospace`;
    shotCtx.textBaseline = 'top';

    for (let y = 0; y < fRows; y++) {
      for (let x = 0; x < fCols; x++) {
        const char = chars[y][x];
        if (char === ' ') continue;
        shotCtx.fillStyle = `rgb(${useColor ? colors[y][x] : MONO_COLOR})`;
        shotCtx.fillText(char, x * cellWidth, y * cellHeight, cellWidth * 1.5);
      }
    }

    // Faint scanlines so the polaroid matches the on-screen look.
    shotCtx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (let y = 0; y < shotHeight; y += 4) {
      shotCtx.fillRect(0, y, shotWidth, 2);
    }

    const dataUrl = shotCanvas.toDataURL('image/png');
    addPolaroid(dataUrl);
  }

  function addPolaroid(dataUrl) {
    if (pinboardEmpty) pinboardEmpty.remove();

    const timestamp = new Date();
    const caption = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const rotation = (Math.random() * 10 - 5).toFixed(1);

    const card = document.createElement('div');
    card.className = 'polaroid';
    card.style.setProperty('--rot', `${rotation}deg`);
    card.innerHTML = `
      <div class="polaroid-pin"></div>
      <img src="${dataUrl}" alt="ASCII snapshot taken at ${caption}">
      <div class="polaroid-caption">${caption}</div>
      <a class="polaroid-download" href="${dataUrl}" download="ascii-polaroid-${timestamp.getTime()}.png" title="Download">&#8681;</a>
    `;
    polaroidBoard.prepend(card);
  }

  function renderLoop() {
    frameToAscii();
    rafId = requestAnimationFrame(renderLoop);
  }

  resSlider.addEventListener('input', () => {
    cols = Number(resSlider.value);
    resValue.textContent = String(cols);
  });

  charsetInput.addEventListener('input', () => {
    asciiRamp = charsetInput.value.length > 0 ? charsetInput.value : DEFAULT_ASCII_RAMP;
  });

  charsetResetBtn.addEventListener('click', () => {
    charsetInput.value = DEFAULT_ASCII_RAMP;
    asciiRamp = DEFAULT_ASCII_RAMP;
  });

  startBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', stopCamera);
  flipBtn.addEventListener('click', flipCamera);
  captureBtn.addEventListener('click', capturePolaroid);

  window.addEventListener('beforeunload', stopCamera);
})();
