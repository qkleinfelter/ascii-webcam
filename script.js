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

  // Darkest to lightest; index chosen by luminance.
  const ASCII_RAMP = '@%#*+=-:. ';
  const CELL_ASPECT = 0.5; // width/height of one ascii "cell" (cols x rows) to mimic a CRT grid
  const GLYPH_WIDTH_RATIO = 0.6; // monospace advance width as a fraction of font-size

  let stream = null;
  let rafId = null;
  let facingMode = 'user';
  let cols = Number(resSlider.value);

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
    startBtn.disabled = false;
    stopBtn.disabled = true;
    flipBtn.disabled = true;
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

    let html = '';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        let luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (invert) luminance = 1 - luminance;

        const rampIndex = Math.min(
          ASCII_RAMP.length - 1,
          Math.floor((1 - luminance) * ASCII_RAMP.length)
        );
        const char = ASCII_RAMP[rampIndex] === ' ' ? '&nbsp;' : ASCII_RAMP[rampIndex];

        if (useColor) {
          html += `<span style="color:rgb(${r},${g},${b})">${char}</span>`;
        } else {
          html += char;
        }
      }
      html += '\n';
    }
    output.innerHTML = html;
  }

  function renderLoop() {
    frameToAscii();
    rafId = requestAnimationFrame(renderLoop);
  }

  resSlider.addEventListener('input', () => {
    cols = Number(resSlider.value);
    resValue.textContent = String(cols);
  });

  startBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', stopCamera);
  flipBtn.addEventListener('click', flipCamera);

  window.addEventListener('beforeunload', stopCamera);
})();
