const DEFAULT_ROWS = 32;
const MAX_ROWS = 100;
const CELL_W = 58;
const CELL_H = 48;
const DX = 58;
const DY = 36;
const PAD_X = 46;
const PAD_Y = 44;

const svg = document.querySelector("#pascalSvg");
const triangleLayer = document.querySelector("#triangleLayer");
const svgTitle = document.querySelector("#svgTitle");
const svgDescription = document.querySelector("#svgDescription");
const diagramTitle = document.querySelector("#diagramTitle");
const ruleDescription = document.querySelector("#ruleDescription");
const blackCount = document.querySelector("#blackCount");
const lightCount = document.querySelector("#lightCount");
const totalCount = document.querySelector("#totalCount");
const layerRange = document.querySelector("#layerRange");
const layerNumber = document.querySelector("#layerNumber");
const selectedLayerLabel = document.querySelector("#selectedLayerLabel");
const selectedCellCount = document.querySelector("#selectedCellCount");
const animationToggle = document.querySelector("#animationToggle");
const animationIcon = document.querySelector("#animationIcon");
const animationLabel = document.querySelector("#animationLabel");
const tooltip = document.querySelector("#tooltip");
const viewport = document.querySelector("#diagramViewport");
const ruleButtons = [...document.querySelectorAll(".rule-button")];

const values = buildPascalRows(MAX_ROWS);
const blackPrefixCounts = buildBlackPrefixCounts(values);
const cells = [];
const rowGroups = [];
const masterWidth = PAD_X * 2 + (MAX_ROWS - 1) * DX + CELL_W;
const masterHeight = PAD_Y * 2 + (MAX_ROWS - 1) * DY + CELL_H;

let currentRows = DEFAULT_ROWS;
let activeDivisor = 0;
let zoom = window.matchMedia("(max-width: 700px)").matches ? 2.1 : 1;
let pendingRows = DEFAULT_ROWS;
let rowAnimationFrame = null;
let layerAnimationTimer = null;
let layerAnimationState = "idle";
let layerAnimationElapsedMs = 0;
let layerAnimationStartedAt = 0;
const LAYER_ANIMATION_DURATION_MS = 10000;
const LAYER_ANIMATION_TICK_MS = 40;

function buildPascalRows(rowCount) {
  const result = [[1n]];
  for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
    const previous = result[rowIndex - 1];
    const row = [1n];
    for (let columnIndex = 1; columnIndex < rowIndex; columnIndex += 1) {
      row.push(previous[columnIndex - 1] + previous[columnIndex]);
    }
    row.push(1n);
    result.push(row);
  }
  return result;
}

function buildBlackPrefixCounts(allRows) {
  const result = {};
  for (let divisor = 2; divisor <= 10; divisor += 1) {
    const prefix = [0];
    let running = 0;
    allRows.forEach((row) => {
      const bigDivisor = BigInt(divisor);
      running += row.reduce((count, value) => count + (value % bigDivisor !== 0n ? 1 : 0), 0);
      prefix.push(running);
    });
    result[divisor] = prefix;
  }
  return result;
}

function makeSvgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function hexPoints(centerX, top) {
  const left = centerX - CELL_W / 2;
  const right = centerX + CELL_W / 2;
  const bottom = top + CELL_H;
  return [
    [centerX, top],
    [right, top + CELL_H * 0.25],
    [right, top + CELL_H * 0.75],
    [centerX, bottom],
    [left, top + CELL_H * 0.75],
    [left, top + CELL_H * 0.25],
  ].map((point) => point.join(",")).join(" ");
}

function textSize(value) {
  const digits = value.toString().length;
  if (digits <= 3) return 14;
  if (digits <= 5) return 12;
  if (digits <= 7) return 10;
  if (digits <= 10) return 8.5;
  if (digits <= 15) return 6.4;
  if (digits <= 21) return 4.8;
  return 3.7;
}

function lightFill(rowIndex) {
  if (rowIndex % 3 === 0) return "#ffffff";
  if (rowIndex % 3 === 1) return "#f3fffb";
  return "#fff7ec";
}

function renderMasterTriangle() {
  svg.setAttribute("viewBox", `0 0 ${masterWidth} ${masterHeight}`);
  svg.setAttribute("width", masterWidth);
  svg.setAttribute("height", masterHeight);
  const fragment = document.createDocumentFragment();

  values.forEach((row, rowIndex) => {
    const rowGroup = makeSvgElement("g", {
      class: "triangle-row",
      "data-row": rowIndex + 1,
    });
    rowGroup.style.display = rowIndex < DEFAULT_ROWS ? "" : "none";
    const firstCenter = masterWidth / 2 - ((row.length - 1) * DX) / 2;
    const top = PAD_Y + rowIndex * DY;

    row.forEach((value, columnIndex) => {
      const centerX = firstCenter + columnIndex * DX;
      const group = makeSvgElement("g", {
        class: "hex-cell",
        tabindex: "-1",
        "data-row": rowIndex + 1,
        "data-column": columnIndex + 1,
        "data-value": value,
      });
      const polygon = makeSvgElement("polygon", {
        class: "hex-shape",
        points: hexPoints(centerX, top),
        fill: lightFill(rowIndex),
        stroke: "#0b6672",
        "stroke-width": 1.35,
      });
      const text = makeSvgElement("text", {
        class: "hex-text",
        x: centerX,
        y: top + CELL_H / 2 + 0.5,
        fill: "#0d2f35",
        "font-size": textSize(value),
        "text-anchor": "middle",
        "dominant-baseline": "middle",
      });
      text.textContent = value.toString();
      group.append(polygon, text);
      group.addEventListener("pointerenter", showTooltip);
      group.addEventListener("pointermove", moveTooltip);
      group.addEventListener("pointerleave", hideTooltip);
      rowGroup.append(group);
      cells.push({ group, polygon, text, rowIndex, value });
    });

    rowGroups.push(rowGroup);
    fragment.append(rowGroup);
  });

  triangleLayer.append(fragment);
}

function totalForRows(rowCount) {
  return (rowCount * (rowCount + 1)) / 2;
}

function clampRows(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return currentRows;
  return Math.min(MAX_ROWS, Math.max(1, parsed));
}

function visibleBlackCount() {
  if (activeDivisor === 0) return 0;
  return blackPrefixCounts[activeDivisor][currentRows];
}

function updateTextAndStats() {
  const total = totalForRows(currentRows);
  const black = visibleBlackCount();
  const light = total - black;

  selectedLayerLabel.textContent = `${currentRows} 層`;
  selectedCellCount.textContent = `共 ${total.toLocaleString("zh-TW")} 個六邊形`;
  blackCount.textContent = black.toLocaleString("zh-TW");
  lightCount.textContent = light.toLocaleString("zh-TW");
  totalCount.textContent = total.toLocaleString("zh-TW");

  if (activeDivisor === 0) {
    diagramTitle.textContent = `${currentRows} 層空白版`;
    ruleDescription.textContent = "所有六邊形維持淺色，數字完整顯示。";
    svgTitle.textContent = `${currentRows} 層巴斯卡三角形空白版`;
    svgDescription.textContent = `共有 ${total} 個淺色六邊形，每個六邊形內都有一個巴斯卡三角形數字。`;
  } else {
    diagramTitle.textContent = `${currentRows} 層 非 ${activeDivisor} 的倍數塗黑`;
    ruleDescription.textContent = `不能被 ${activeDivisor} 整除的數字塗黑；${activeDivisor} 的倍數保留淺色。`;
    svgTitle.textContent = `${currentRows} 層巴斯卡三角形，非 ${activeDivisor} 的倍數塗黑`;
    svgDescription.textContent = `共有 ${black} 個黑色六邊形與 ${light} 個淺色六邊形。`;
  }
}

function setVisibleRows(rowCount) {
  currentRows = clampRows(rowCount);
  layerRange.value = currentRows;
  layerNumber.value = currentRows;

  rowGroups.forEach((group, rowIndex) => {
    group.style.display = rowIndex < currentRows ? "" : "none";
  });

  const currentWidth = PAD_X * 2 + (currentRows - 1) * DX + CELL_W;
  const currentHeight = PAD_Y * 2 + (currentRows - 1) * DY + CELL_H;
  const viewBoxX = (masterWidth - currentWidth) / 2;
  svg.setAttribute("viewBox", `${viewBoxX} 0 ${currentWidth} ${currentHeight}`);
  svg.setAttribute("width", currentWidth);
  svg.setAttribute("height", currentHeight);
  updateTextAndStats();
}

function queueVisibleRows(value) {
  pendingRows = clampRows(value);
  layerRange.value = pendingRows;
  layerNumber.value = pendingRows;
  selectedLayerLabel.textContent = `${pendingRows} 層`;
  selectedCellCount.textContent = `共 ${totalForRows(pendingRows).toLocaleString("zh-TW")} 個六邊形`;

  if (rowAnimationFrame !== null) return;
  rowAnimationFrame = requestAnimationFrame(() => {
    rowAnimationFrame = null;
    setVisibleRows(pendingRows);
  });
}

function setAnimationUi(state) {
  layerAnimationState = state;
  const playing = state === "playing";
  animationToggle.classList.toggle("is-playing", playing);
  animationToggle.setAttribute("aria-pressed", String(playing));
  if (playing) {
    animationIcon.textContent = "❚❚";
    animationLabel.textContent = "暫停動畫";
  } else if (state === "paused") {
    animationIcon.textContent = "▶";
    animationLabel.textContent = "繼續動畫";
  } else if (state === "complete") {
    animationIcon.textContent = "↺";
    animationLabel.textContent = "重新播放";
  } else {
    animationIcon.textContent = "▶";
    animationLabel.textContent = "播放 1→100";
  }
}

function clearLayerAnimationTimer() {
  if (layerAnimationTimer !== null) {
    clearTimeout(layerAnimationTimer);
    layerAnimationTimer = null;
  }
}

function cancelLayerAnimation() {
  clearLayerAnimationTimer();
  layerAnimationElapsedMs = 0;
  setAnimationUi("idle");
}

function runLayerAnimationStep() {
  if (layerAnimationState !== "playing") return;
  const elapsed = layerAnimationElapsedMs + (performance.now() - layerAnimationStartedAt);
  const progress = Math.min(1, elapsed / LAYER_ANIMATION_DURATION_MS);
  const nextRows = Math.min(MAX_ROWS, 1 + Math.floor(progress * (MAX_ROWS - 1)));
  setVisibleRows(nextRows);
  if (nextRows >= MAX_ROWS) {
    clearLayerAnimationTimer();
    layerAnimationElapsedMs = LAYER_ANIMATION_DURATION_MS;
    setAnimationUi("complete");
    return;
  }
  layerAnimationTimer = setTimeout(runLayerAnimationStep, LAYER_ANIMATION_TICK_MS);
}

function startLayerAnimation() {
  clearLayerAnimationTimer();
  layerAnimationElapsedMs = 0;
  layerAnimationStartedAt = performance.now();
  setVisibleRows(1);
  setAnimationUi("playing");
  layerAnimationTimer = setTimeout(runLayerAnimationStep, LAYER_ANIMATION_TICK_MS);
}

function pauseLayerAnimation() {
  layerAnimationElapsedMs += performance.now() - layerAnimationStartedAt;
  clearLayerAnimationTimer();
  setAnimationUi("paused");
}

function resumeLayerAnimation() {
  layerAnimationStartedAt = performance.now();
  setAnimationUi("playing");
  layerAnimationTimer = setTimeout(runLayerAnimationStep, LAYER_ANIMATION_TICK_MS);
}

function toggleLayerAnimation() {
  if (layerAnimationState === "playing") {
    pauseLayerAnimation();
  } else if (layerAnimationState === "paused") {
    resumeLayerAnimation();
  } else {
    startLayerAnimation();
  }
}

function updatePattern(divisor) {
  activeDivisor = divisor;
  const bigDivisor = divisor > 0 ? BigInt(divisor) : null;

  cells.forEach((cell) => {
    const shouldBlacken = bigDivisor !== null && cell.value % bigDivisor !== 0n;
    cell.polygon.setAttribute("fill", shouldBlacken ? "#091013" : lightFill(cell.rowIndex));
    cell.polygon.setAttribute("stroke", shouldBlacken ? "#091013" : "#0b6672");
    cell.text.setAttribute("fill", shouldBlacken ? "#ffffff" : "#0d2f35");
  });

  ruleButtons.forEach((button) => {
    const active = Number(button.dataset.divisor) === divisor;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateTextAndStats();
}

function showTooltip(event) {
  const target = event.currentTarget;
  const value = BigInt(target.dataset.value);
  const status = activeDivisor === 0
    ? "空白版"
    : value % BigInt(activeDivisor) === 0n
      ? `是 ${activeDivisor} 的倍數`
      : `非 ${activeDivisor} 的倍數`;
  tooltip.innerHTML = `<strong>${value.toLocaleString("zh-TW")}</strong>第 ${target.dataset.row} 層 · 第 ${target.dataset.column} 個<br>${status}`;
  tooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const gap = 14;
  const width = 170;
  const x = Math.min(event.clientX + gap, window.innerWidth - width - 8);
  const y = Math.min(event.clientY + gap, window.innerHeight - 90);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function updateZoom(nextZoom) {
  zoom = Math.max(0.75, Math.min(12, nextZoom));
  svg.style.width = `${zoom * 100}%`;
}

function downloadCurrentSvg() {
  const clone = svg.cloneNode(true);
  clone.removeAttribute("style");
  [...clone.querySelectorAll(".triangle-row")].forEach((row, rowIndex) => {
    if (rowIndex >= currentRows) row.remove();
    else row.removeAttribute("style");
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const stylesheet = document.createElementNS("http://www.w3.org/2000/svg", "style");
  stylesheet.textContent = ".hex-text{font-family:Arial,sans-serif;font-weight:700}.hex-shape{stroke-linejoin:round}";
  clone.prepend(stylesheet);
  const source = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = activeDivisor === 0
    ? `巴斯卡三角形_${currentRows}層_空白版.svg`
    : `巴斯卡三角形_${currentRows}層_非${activeDivisor}倍數塗黑.svg`;
  link.click();
  URL.revokeObjectURL(link.href);
}

ruleButtons.forEach((button, index) => {
  button.addEventListener("click", () => updatePattern(Number(button.dataset.divisor)));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "ArrowRight"
      ? (index + 1) % ruleButtons.length
      : (index - 1 + ruleButtons.length) % ruleButtons.length;
    ruleButtons[next].focus();
    ruleButtons[next].click();
  });
});

document.querySelector("#resetButton").addEventListener("click", () => updatePattern(0));
document.querySelector("#zoomOut").addEventListener("click", () => updateZoom(zoom - 0.25));
document.querySelector("#zoomIn").addEventListener("click", () => updateZoom(zoom + 0.25));
document.querySelector("#zoomFit").addEventListener("click", () => {
  updateZoom(1);
  viewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
});
document.querySelector("#downloadSvg").addEventListener("click", downloadCurrentSvg);
animationToggle.addEventListener("click", toggleLayerAnimation);
layerRange.addEventListener("input", (event) => {
  cancelLayerAnimation();
  queueVisibleRows(event.target.value);
});
layerNumber.addEventListener("input", (event) => {
  if (event.target.value !== "") {
    cancelLayerAnimation();
    queueVisibleRows(event.target.value);
  }
});
layerNumber.addEventListener("blur", (event) => {
  cancelLayerAnimation();
  queueVisibleRows(event.target.value || currentRows);
});

renderMasterTriangle();
updateZoom(zoom);
setVisibleRows(DEFAULT_ROWS);
updatePattern(0);
